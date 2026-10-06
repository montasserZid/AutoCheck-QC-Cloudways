import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BATCH_SIZE, beginImport, classifyYear, dryRun, importSource, isArtifactCategory, isRepresentativeSamplePath, isStructurallyIncompleteProblem, normalizedKey, SAMPLE_DEFINITION_HASH, validateProblem, writeYearForImport } from "../scripts/knowledge/importer";

test("knowledge importer uses deterministic keys without fuzzy matching", () => {
  assert.equal(normalizedKey("CX-5"), "cx5");
  assert.equal(normalizedKey("RS 3"), "rs3");
  assert.notEqual(normalizedKey("CX-5"), normalizedKey("CX-9"));
});

test("knowledge importer classifies source anomalies without discarding them", () => {
  assert.equal(classifyYear(2018).qualityStatus, "eligible");
  assert.equal(classifyYear(0).qualityStatus, "quarantined_invalid_year");
  assert.equal(isArtifactCategory("add your complaint »"), true);
  assert.equal(isArtifactCategory("transmission"), false);
  assert.equal(isStructurallyIncompleteProblem({ problem: "Recalls", reports: 0 }), true);
  assert.equal(isRepresentativeSamplePath("Buick", "Skylark", 1970), true);
  assert.equal(isRepresentativeSamplePath("Dodge", "Ram 1500", 2009), true);
});

test("knowledge snapshot identity separates a real source SHA by full or deterministic sample scope", async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const database = { async query(text: string, values?: unknown[]) { calls.push({ text, values }); if (text.includes("returning id")) return { rows: [{ id: text.includes("'sample'") ? 2 : 1 }] }; return { rows: [] }; } };
  const source = { name: "CarComplaints.com", bytes: 1, sha256: "a".repeat(64) };
  const full = await beginImport(database as never, source, { scope: "full", sampleDefinitionHash: null }, "00000000-0000-0000-0000-000000000001");
  const sample = await beginImport(database as never, source, { scope: "sample", sampleDefinitionHash: SAMPLE_DEFINITION_HASH }, "00000000-0000-0000-0000-000000000002");
  assert.equal(full.snapshotId, 1); assert.equal(sample.snapshotId, 2); assert.equal(sample.sampleDefinitionHash, SAMPLE_DEFINITION_HASH);
  assert.ok(calls.some((call) => call.text.includes("where scope='full'")));
  assert.ok(calls.some((call) => call.text.includes("where scope='sample'")));
});

test("knowledge run keys cannot cross source scope or sample definition", async () => {
  const database = { async query(text: string) { if (text.includes("from knowledge.import_run ir")) return { rows: [{ snapshot_id: "1", last_source_path: null, rows_read: "0", rows_written: "0", rows_quarantined: "0", source_sha256: "a".repeat(64), scope: "full", sample_definition_hash: null }] }; return { rows: [] }; } };
  await assert.rejects(() => beginImport(database as never, { name: "CarComplaints.com", bytes: 1, sha256: "a".repeat(64) }, { scope: "sample", sampleDefinitionHash: SAMPLE_DEFINITION_HASH }, "00000000-0000-0000-0000-000000000001"), /does not match/);
});

test("knowledge importer preserves nullable fields and rejects impossible values", () => {
  assert.doesNotThrow(() => validateProblem({ problem: "Transmission", reports: 0, total_complaints: null, repair: { typical_cost_usd: null, average_mileage: null } }));
  assert.throws(() => validateProblem({ problem: "Transmission", reports: -1 }));
  assert.throws(() => validateProblem({ problem: "Transmission", reports: 1, severity: { score: 11 } }));
  assert.equal(isRepresentativeSamplePath("Toyota", "Yaris", 2010), true);
  assert.equal(isRepresentativeSamplePath("Mazda", "CX-9", 2010), false);
});

test("knowledge writer checkpoints only inside a successful committed transaction", async () => {
  const calls: string[] = [];
  const database = { async query(text: string) { calls.push(text); if (text.includes("aggregate_problem")) return { rows: [{ id: 1, category_id: 1, source_problem_title: "stall", source_url: "https://example.test/problem" }] }; return { rows: text.includes("returning id") ? [{ id: 1 }] : [] }; } };
  const state = await writeYearForImport(database as never, { snapshotId: 1, runKey: "00000000-0000-0000-0000-000000000001", scope: "full", sampleDefinitionHash: null, lastSourcePath: null, rowsRead: 0, rowsWritten: 0, rowsQuarantined: 0 }, { brand: "Toyota", url: "https://example.test/toyota" }, { model: "Yaris", complaint_count: 1, url: "https://example.test/yaris" }, { year: 2010, reported_problems: 1, url: "https://example.test/2010", categories: [{ category: "engine", complaint_count: 1, url: "https://example.test/engine", problems: [{ problem: "stall", reports: 1, url: "https://example.test/problem", severity: { score: 8 }, common_solutions: [{ solution: "repair", reports: 1 }] }] }] });
  assert.equal(calls[0], "BEGIN");
  assert.ok(calls.findIndex((call) => call.includes("update knowledge.import_run")) < calls.indexOf("COMMIT"));
  assert.equal(state.lastSourcePath, "Toyota/Yaris/2010");
});

test("knowledge writer rolls back and never checkpoints a failed hierarchy", async () => {
  const calls: string[] = [];
  const database = { async query(text: string) { calls.push(text); if (text.includes("knowledge.category_observation")) throw new Error("simulated constraint failure"); return { rows: text.includes("returning id") ? [{ id: 1 }] : [] }; } };
  await assert.rejects(() => writeYearForImport(database as never, { snapshotId: 1, runKey: "00000000-0000-0000-0000-000000000001", scope: "full", sampleDefinitionHash: null, lastSourcePath: null, rowsRead: 0, rowsWritten: 0, rowsQuarantined: 0 }, { brand: "Toyota", url: "https://example.test/toyota" }, { model: "Yaris", complaint_count: 1, url: "https://example.test/yaris" }, { year: 2010, reported_problems: 1, url: "https://example.test/2010", categories: [{ category: "engine", complaint_count: 1, url: "https://example.test/engine" }] }));
  assert.ok(calls.includes("ROLLBACK"));
  assert.equal(calls.some((call) => call.includes("update knowledge.import_run")), false);
});

test("knowledge writer emits bounded multi-row problem and solution batches with returned parent ids", async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const database = { async query(text: string, values?: unknown[]) {
    calls.push({ text, values });
    if (text.includes("aggregate_problem")) return { rows: Array.from({ length: (values?.length ?? 0) / 16 }, (_, index) => ({ id: index + 100, category_id: values![index * 16], source_problem_title: values![index * 16 + 1], source_url: values![index * 16 + 13] })) };
    return { rows: text.includes("returning id") ? [{ id: 1 }] : [] };
  } };
  const problems = Array.from({ length: BATCH_SIZE + 1 }, (_, index) => ({ problem: `problem-${index}`, reports: 1, url: `https://example.test/problem-${index}`, severity: { score: 1 }, common_solutions: [{ solution: `solution-${index}`, reports: 1 }] }));
  await writeYearForImport(database as never, { snapshotId: 1, runKey: "00000000-0000-0000-0000-000000000001", scope: "full", sampleDefinitionHash: null, lastSourcePath: null, rowsRead: 0, rowsWritten: 0, rowsQuarantined: 0 }, { brand: "Toyota", url: "https://example.test/toyota" }, { model: "Yaris", complaint_count: 1, url: "https://example.test/yaris" }, { year: 2010, reported_problems: 1, url: "https://example.test/2010", categories: [{ category: "engine", complaint_count: 1, url: "https://example.test/engine", problems }] });
  const problemCalls = calls.filter((call) => call.text.includes("insert into knowledge.aggregate_problem"));
  const solutionCalls = calls.filter((call) => call.text.includes("insert into knowledge.common_solution"));
  assert.equal(problemCalls.length, 2);
  assert.equal(solutionCalls.length, 2);
  assert.deepEqual(problemCalls.map((call) => (call.values?.length ?? 0) / 16), [BATCH_SIZE, 1]);
  assert.deepEqual(solutionCalls.map((call) => (call.values?.length ?? 0) / 4), [BATCH_SIZE, 1]);
  assert.ok(solutionCalls[0].values?.includes(100));
  assert.ok(problemCalls.every((call) => call.text.includes("on conflict (category_id, source_problem_title, source_url)")));
});

test("knowledge writer repeats natural-key upserts without a delete/reimport operation", async () => {
  const calls: string[] = [];
  const database = { async query(text: string, values?: unknown[]) { calls.push(text); if (text.includes("aggregate_problem")) return { rows: [{ id: 7, category_id: values![0], source_problem_title: values![1], source_url: values![13] }] }; return { rows: text.includes("returning id") ? [{ id: 1 }] : [] }; } };
  const state = { snapshotId: 1, runKey: "00000000-0000-0000-0000-000000000001", scope: "full" as const, sampleDefinitionHash: null, lastSourcePath: null, rowsRead: 0, rowsWritten: 0, rowsQuarantined: 0 };
  const brand = { brand: "Toyota", url: "https://example.test/toyota" }; const model = { model: "Yaris", complaint_count: 1, url: "https://example.test/yaris" }; const year = { year: 2010, reported_problems: 1, url: "https://example.test/2010", categories: [{ category: "engine", complaint_count: 1, url: "https://example.test/engine", problems: [{ problem: "stall", reports: 1, url: "https://example.test/problem", severity: { score: 1 } }] }] };
  await writeYearForImport(database as never, state, brand, model, year); await writeYearForImport(database as never, state, brand, model, year);
  assert.equal(calls.some((call) => /delete\s+from/i.test(call)), false);
  assert.equal(calls.filter((call) => call.includes("aggregate_problem")).every((call) => call.includes("on conflict (category_id, source_problem_title, source_url)")), true);
});

test("knowledge import resumes immediately after its committed source path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "autocheck-knowledge-")); const file = join(directory, "source.json");
  await writeFile(file, JSON.stringify({ brands: [{ brand: "Toyota", url: "https://example.test/toyota", models: [{ model: "Yaris", complaint_count: 0, url: "https://example.test/yaris", years: [{ year: 2010, reported_problems: 0, url: "https://example.test/2010", categories: [] }, { year: 2011, reported_problems: 0, url: "https://example.test/2011", categories: [] }] }] }] }));
  const checkpointPaths: string[] = [];
  const database = { async query(text: string, values?: unknown[]) { if (text.includes("select last_source_path")) return { rows: [{ last_source_path: "Toyota/Yaris/2010", rows_read: "1", rows_written: "3", rows_quarantined: "0" }] }; if (text.includes("returning id")) return { rows: [{ id: 1 }] }; if (text.includes("set last_source_path")) checkpointPaths.push(String(values?.[0])); return { rows: [] }; } };
  try { await importSource(file, database as never, { runKey: "00000000-0000-0000-0000-000000000001" }); assert.deepEqual(checkpointPaths, ["Toyota/Yaris/2011"]); } finally { await rm(directory, { recursive: true, force: true }); }
});

test("dry run needs no database object and performs no writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "autocheck-knowledge-")); const file = join(directory, "source.json");
  await writeFile(file, JSON.stringify({ brands: [{ brand: "Toyota", url: "https://example.test/toyota", models: [{ model: "Yaris", complaint_count: 0, url: "https://example.test/yaris", years: [] }] }] }));
  try { const result = await dryRun(file); assert.equal(result.sourceModels, 1); assert.equal(result.modelYears, 0); } finally { await rm(directory, { recursive: true, force: true }); }
});
