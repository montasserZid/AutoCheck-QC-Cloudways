/* Phase 5A trusted-machine, credential-free streaming preflight. */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
// Kept structural so the trusted-machine CLI can typecheck even if an
// environment has installed `pg` without its optional DefinitelyTyped package.
// Runtime write mode still requires the declared `pg` dependency.
type QueryResultRow = Record<string, unknown>;
type QueryResult<T extends QueryResultRow = QueryResultRow> = { rows: T[] };
interface PgClient { query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>; connect(): Promise<void>; end(): Promise<void>; }
const PgClientConstructor = require("pg").Client as new (options: { connectionString: string }) => PgClient;

export type SourceProblem = { problem?: unknown; reports?: unknown; url?: unknown; severity?: { score?: unknown; label?: unknown } | null; repair?: { typical_cost_usd?: unknown; raw_cost?: unknown; average_mileage?: unknown; raw_mileage?: unknown; mileage_unit?: unknown } | null; total_complaints?: unknown; faulty_part?: unknown; warranty_note?: unknown; common_solutions?: Array<{ solution?: unknown; reports?: unknown }> };
export type SourceCategory = { category?: unknown; complaint_count?: unknown; nhtsa_complaint_count?: unknown; url?: unknown; problems?: SourceProblem[] };
export type SourceYear = { year?: unknown; reported_problems?: unknown; url?: unknown; categories?: SourceCategory[] };
export type SourceModel = { model?: unknown; complaint_count?: unknown; url?: unknown; years?: SourceYear[] };
export type SourceBrand = { brand?: unknown; url?: unknown; models?: SourceModel[] };
export type ImportSummary = { sourceBytes: number; sha256: string; makes: number; sourceModels: number; modelYears: number; categories: number; aggregateProblems: number; commonSolutions: number; eligibleYears: number; quarantinedYears: number; artifactCategories: number; incompleteProblems: number; unmappedSourceModels: number; selectedModels: number };

const MAX_ELEMENT_BYTES = 32 * 1024 * 1024;
export type ImportScope = "full" | "sample";
export const SAMPLE_DEFINITION_VERSION = "phase5c-representative-v2";
const SAMPLE_MODEL_KEYS = ["toyota/yaris", "ford/explorer", "mazda/cx5", "honda/hrv", "audi/rs3", "ram/promaster", "dodge/promaster"] as const;
const SAMPLE_ANOMALY_PATHS = ["buick/skylark/1970", "dodge/ram1500/2009"] as const;
export const SAMPLE_DEFINITION_HASH = createHash("sha256").update(JSON.stringify({ version: SAMPLE_DEFINITION_VERSION, modelKeys: [...SAMPLE_MODEL_KEYS].sort(), anomalyPaths: [...SAMPLE_ANOMALY_PATHS].sort(), includeYearZero: true })).digest("hex");
export function normalizedKey(value: string): string { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ").replace(/[^a-z0-9]/g, ""); }
function string(value: unknown, label: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`); return value.trim(); }
function count(value: unknown, label: string, nullable = false): number | null { if (value == null && nullable) return null; if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`); return value; }
export function classifyYear(year: number): { qualityStatus: "eligible" | "quarantined_invalid_year"; quarantineReason: string | null } { return year >= 1886 && year <= 2100 ? { qualityStatus: "eligible", quarantineReason: null } : { qualityStatus: "quarantined_invalid_year", quarantineReason: `source year ${year} is outside 1886-2100` }; }
export function isArtifactCategory(value: string): boolean { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes("add your complaint"); }
export function isStructurallyIncompleteProblem(problem: SourceProblem): boolean { return !problem.severity && !problem.repair; }
export function validateProblem(problem: SourceProblem): void { string(problem.problem, "problem title"); count(problem.reports, "problem reports"); count(problem.total_complaints, "total complaints", true); if (problem.severity?.score != null && (typeof problem.severity.score !== "number" || problem.severity.score < 0 || problem.severity.score > 10)) throw new Error("severity score must be between 0 and 10"); if (problem.repair) { count(problem.repair.typical_cost_usd, "repair cost", true); count(problem.repair.average_mileage, "average mileage", true); if (problem.repair.mileage_unit != null && !["miles", "km", "unknown"].includes(String(problem.repair.mileage_unit))) throw new Error("mileage unit is invalid"); } }
export function isRepresentativeSamplePath(make: string, model: string, year: number): boolean { const modelKey = `${normalizedKey(make)}/${normalizedKey(model)}`; return SAMPLE_MODEL_KEYS.includes(modelKey as typeof SAMPLE_MODEL_KEYS[number]) || year === 0 || SAMPLE_ANOMALY_PATHS.includes(`${modelKey}/${year}` as typeof SAMPLE_ANOMALY_PATHS[number]); }

/** Streams one root `brands` array element at a time; never parses the full file. */
export async function* streamBrands(filePath: string): AsyncGenerator<SourceBrand> {
  let prefix = "", active = false, started = false, quoted = false, escaped = false, depth = 0, element = "";
  for await (const chunk of createReadStream(filePath, { encoding: "utf8" })) for (const char of chunk) {
    if (!active) { prefix = (prefix + char).slice(-64); if (/"brands"\s*:\s*\[$/.test(prefix)) active = true; continue; }
    if (!started) { if (/\s|,/.test(char)) continue; if (char === "]") return; if (char !== "{") throw new Error("brands must contain objects"); started = true; depth = 1; element = "{"; continue; }
    element += char; if (element.length > MAX_ELEMENT_BYTES) throw new Error("one brand exceeds the importer memory bound");
    if (quoted) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') quoted = true; else if (char === "{") depth += 1; else if (char === "}" && --depth === 0) { yield JSON.parse(element) as SourceBrand; started = false; element = ""; }
  }
  if (!active || started) throw new Error("truncated or malformed root brands array");
}
export async function sha256File(filePath: string): Promise<string> { const hash = createHash("sha256"); for await (const chunk of createReadStream(filePath)) hash.update(chunk); return hash.digest("hex"); }
export async function dryRun(filePath: string, sampleOnly = false): Promise<ImportSummary> {
  const summary: ImportSummary = { sourceBytes: (await stat(filePath)).size, sha256: await sha256File(filePath), makes: 0, sourceModels: 0, modelYears: 0, categories: 0, aggregateProblems: 0, commonSolutions: 0, eligibleYears: 0, quarantinedYears: 0, artifactCategories: 0, incompleteProblems: 0, unmappedSourceModels: 0, selectedModels: 0 };
  for await (const brand of streamBrands(filePath)) { const make = string(brand.brand, "brand"); string(brand.url, "brand url"); summary.makes++;
    for (const model of brand.models ?? []) { const modelName = string(model.model, "model"); count(model.complaint_count, "model complaint count"); string(model.url, "model url"); const selected = !sampleOnly || (model.years ?? []).some((y) => typeof y.year === "number" && isRepresentativeSamplePath(make, modelName, y.year)); if (!selected) continue; summary.selectedModels++; summary.sourceModels++; summary.unmappedSourceModels++;
      for (const sourceYear of model.years ?? []) { const year = count(sourceYear.year, "model year")!; if (sampleOnly && !isRepresentativeSamplePath(make, modelName, year)) continue; count(sourceYear.reported_problems, "reported problems"); string(sourceYear.url, "year url"); summary.modelYears++; if (classifyYear(year).qualityStatus === "eligible") summary.eligibleYears++; else summary.quarantinedYears++;
        for (const category of sourceYear.categories ?? []) { const categoryName = string(category.category, "category"); count(category.complaint_count, "category complaint count"); count(category.nhtsa_complaint_count, "NHTSA complaint count", true); string(category.url, "category url"); summary.categories++; if (isArtifactCategory(categoryName)) summary.artifactCategories++;
          for (const problem of category.problems ?? []) { validateProblem(problem); summary.aggregateProblems++; if (isStructurallyIncompleteProblem(problem)) summary.incompleteProblems++; for (const solution of problem.common_solutions ?? []) { string(solution.solution, "solution"); count(solution.reports, "solution reports"); summary.commonSolutions++; } }
        }
      }
    }
  }
  return summary;
}
type Database = Pick<PgClient, "query">;
type IdRow = QueryResultRow & { id: string | number };
export const BATCH_SIZE = 500;

function sourcePath(make: string, model: string, year: number): string { return `${make}/${model}/${year}`; }
function nullableText(value: unknown): string | null { return typeof value === "string" ? value : null; }
function url(value: unknown, label: string): string { const result = string(value, label); if (!result.startsWith("https://")) throw new Error(`${label} must use HTTPS`); return result; }
function id(row: IdRow | undefined, label: string): number { if (!row) throw new Error(`${label} did not return an id`); return Number(row.id); }
function chunks<T>(values: T[]): T[][] { const result: T[][] = []; for (let i = 0; i < values.length; i += BATCH_SIZE) result.push(values.slice(i, i + BATCH_SIZE)); return result; }

async function one(db: Database, text: string, values: unknown[], label: string): Promise<number> { return id((await db.query<IdRow>(text, values)).rows[0], label); }

export type ImportRunState = { snapshotId: number; runKey: string; scope: ImportScope; sampleDefinitionHash: string | null; lastSourcePath: string | null; rowsRead: number; rowsWritten: number; rowsQuarantined: number };

/** Opens/resumes a run only in explicit write mode. The URL is never logged. */
export async function beginImport(db: Database, source: { name: string; bytes: number; sha256: string; scrapedAt?: string | null }, identity: { scope: ImportScope; sampleDefinitionHash: string | null }, runKey: string = randomUUID()): Promise<ImportRunState> {
  const prior = await db.query<QueryResultRow & { snapshot_id: string; last_source_path: string | null; rows_read: string; rows_written: string; rows_quarantined: string; source_sha256: string; scope: ImportScope; sample_definition_hash: string | null }>(`select ir.snapshot_id, ir.last_source_path, ir.rows_read, ir.rows_written, ir.rows_quarantined, s.source_sha256, s.scope, s.sample_definition_hash from knowledge.import_run ir join knowledge.source_snapshot s on s.id=ir.snapshot_id where ir.run_key=$1`, [runKey]);
  if (prior.rows[0]) { const row = prior.rows[0]; if (row.source_sha256 !== source.sha256 || row.scope !== identity.scope || row.sample_definition_hash !== identity.sampleDefinitionHash) throw new Error("run key does not match the requested source snapshot scope"); return { snapshotId: Number(row.snapshot_id), runKey, scope: identity.scope, sampleDefinitionHash: identity.sampleDefinitionHash, lastSourcePath: row.last_source_path, rowsRead: Number(row.rows_read), rowsWritten: Number(row.rows_written), rowsQuarantined: Number(row.rows_quarantined) }; }
  const snapshotId = identity.scope === "full"
    ? await one(db, `insert into knowledge.source_snapshot (source_name, source_scraped_at, source_sha256, source_bytes, import_status, imported_at, importer_version, scope, sample_definition_hash) values ($1,$2,$3,$4,'importing',clock_timestamp(),'knowledge-importer/5c','full',null) on conflict (source_sha256) where scope='full' do update set import_status=case when knowledge.source_snapshot.import_status='ready' then 'ready' else 'importing' end returning id`, [source.name, source.scrapedAt ?? null, source.sha256, source.bytes], "full source snapshot")
    : await one(db, `insert into knowledge.source_snapshot (source_name, source_scraped_at, source_sha256, source_bytes, import_status, imported_at, importer_version, scope, sample_definition_hash) values ($1,$2,$3,$4,'importing',clock_timestamp(),'knowledge-importer/5c','sample',$5) on conflict (source_sha256, sample_definition_hash) where scope='sample' do update set import_status=case when knowledge.source_snapshot.import_status='ready' then 'ready' else 'importing' end returning id`, [source.name, source.scrapedAt ?? null, source.sha256, source.bytes, identity.sampleDefinitionHash], "sample source snapshot");
  const existing = await db.query<QueryResultRow & { last_source_path: string | null; rows_read: string; rows_written: string; rows_quarantined: string }>(`select last_source_path, rows_read, rows_written, rows_quarantined from knowledge.import_run where snapshot_id = $1 and run_key = $2`, [snapshotId, runKey]);
  if (existing.rows[0]) { const row = existing.rows[0]; return { snapshotId, runKey, scope: identity.scope, sampleDefinitionHash: identity.sampleDefinitionHash, lastSourcePath: row.last_source_path, rowsRead: Number(row.rows_read), rowsWritten: Number(row.rows_written), rowsQuarantined: Number(row.rows_quarantined) }; }
  await db.query(`insert into knowledge.import_run (snapshot_id, run_key, phase, started_at) values ($1, $2, 'load', clock_timestamp())`, [snapshotId, runKey]);
  return { snapshotId, runKey, scope: identity.scope, sampleDefinitionHash: identity.sampleDefinitionHash, lastSourcePath: null, rowsRead: 0, rowsWritten: 0, rowsQuarantined: 0 };
}

async function upsertMakeAndModel(db: Database, snapshotId: number, brand: SourceBrand, model: SourceModel): Promise<{ makeId: number; modelId: number }> {
  const make = string(brand.brand, "brand");
  const makeId = await one(db, `insert into knowledge.make (snapshot_id, source_make, canonical_make_key, source_url) values ($1,$2,$3,$4)
    on conflict (snapshot_id, source_make) do update set canonical_make_key=excluded.canonical_make_key, source_url=excluded.source_url returning id`, [snapshotId, make, normalizedKey(make), url(brand.url, "brand url")], "make");
  const modelName = string(model.model, "model");
  const modelId = await one(db, `insert into knowledge.source_model (make_id, canonical_model_id, source_model, source_model_key, source_complaint_count, source_url, mapping_status) values ($1,null,$2,$3,$4,$5,'unmapped')
    on conflict (make_id, source_model) do update set source_model_key=excluded.source_model_key, source_complaint_count=excluded.source_complaint_count, source_url=excluded.source_url returning id`, [makeId, modelName, normalizedKey(modelName), count(model.complaint_count, "model complaint count"), url(model.url, "model url")], "source model");
  return { makeId, modelId };
}

type PreparedProblem = { categoryId: number; title: string; sourceUrl: string | null; incomplete: boolean; problem: SourceProblem; values: unknown[] };
function problemKey(problem: Pick<PreparedProblem, "categoryId" | "title" | "sourceUrl">): string { return `${problem.categoryId}|${problem.title}|${problem.sourceUrl ?? "<null>"}`; }
function valuesSql(rows: unknown[][], width: number): { placeholders: string; values: unknown[] } { return { placeholders: rows.map((_, row) => `(${Array.from({ length: width }, (_, column) => `$${row * width + column + 1}`).join(",")})`).join(","), values: rows.flat() }; }

async function upsertProblemBatch(db: Database, prepared: PreparedProblem[]): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  const nonNull = prepared.filter((row) => row.sourceUrl !== null);
  const nullUrl = prepared.filter((row) => row.sourceUrl === null);
  const insert = async (rows: PreparedProblem[]): Promise<void> => {
    if (!rows.length) return;
    const query = valuesSql(rows.map((row) => row.values), 16);
    const result = await db.query<QueryResultRow & { id: string | number; category_id: string | number; source_problem_title: string; source_url: string | null }>(`insert into knowledge.aggregate_problem (category_id, source_problem_title, reports_count, total_complaints_count, severity_score, severity_label, typical_repair_cost_usd, repair_cost_raw, average_mileage, mileage_raw, mileage_unit, faulty_part, warranty_note, source_url, display_status, quarantine_reason) values ${query.placeholders}
      on conflict (category_id, source_problem_title, source_url) do update set reports_count=excluded.reports_count, total_complaints_count=excluded.total_complaints_count, severity_score=excluded.severity_score, severity_label=excluded.severity_label, typical_repair_cost_usd=excluded.typical_repair_cost_usd, repair_cost_raw=excluded.repair_cost_raw, average_mileage=excluded.average_mileage, mileage_raw=excluded.mileage_raw, mileage_unit=excluded.mileage_unit, faulty_part=excluded.faulty_part, warranty_note=excluded.warranty_note, display_status=excluded.display_status, quarantine_reason=excluded.quarantine_reason returning id, category_id, source_problem_title, source_url`, query.values);
    for (const row of result.rows) ids.set(`${row.category_id}|${row.source_problem_title}|${row.source_url ?? "<null>"}`, Number(row.id));
  };
  await insert(nonNull);
  if (nullUrl.length) {
    const lookup = valuesSql(nullUrl.map((row) => [row.categoryId, row.title]), 2);
    const existing = await db.query<QueryResultRow & { id: string | number; category_id: string | number; source_problem_title: string }>(`select p.id, p.category_id, p.source_problem_title from knowledge.aggregate_problem p join (values ${lookup.placeholders}) as wanted(category_id, source_problem_title) on p.category_id=wanted.category_id and p.source_problem_title=wanted.source_problem_title where p.source_url is null`, lookup.values);
    for (const row of existing.rows) ids.set(`${row.category_id}|${row.source_problem_title}|<null>`, Number(row.id));
    await insert(nullUrl.filter((row) => !ids.has(problemKey(row))));
  }
  return ids;
}

export async function writeYearForImport(db: Database, state: ImportRunState, brand: SourceBrand, model: SourceModel, yearRecord: SourceYear): Promise<ImportRunState> {
  const make = string(brand.brand, "brand"); const modelName = string(model.model, "model"); const year = count(yearRecord.year, "model year")!;
  const path = sourcePath(make, modelName, year); const yearClass = classifyYear(year); let written = 0; let quarantined = yearClass.qualityStatus === "eligible" ? 0 : 1;
  await db.query("BEGIN");
  try {
    const { modelId } = await upsertMakeAndModel(db, state.snapshotId, brand, model); written += 2;
    const modelYearId = await one(db, `insert into knowledge.model_year (source_model_id, model_year, source_reported_problems, source_url, quality_status, quarantine_reason) values ($1,$2,$3,$4,$5,$6)
      on conflict (source_model_id, model_year) do update set source_reported_problems=excluded.source_reported_problems, source_url=excluded.source_url, quality_status=excluded.quality_status, quarantine_reason=excluded.quarantine_reason returning id`, [modelId, year, count(yearRecord.reported_problems, "reported problems"), url(yearRecord.url, "year url"), yearClass.qualityStatus, yearClass.quarantineReason], "model year"); written++;
    const categoryProblems: Array<{ categoryId: number; problem: SourceProblem }> = [];
    for (const category of yearRecord.categories ?? []) {
      const categoryName = string(category.category, "category"); const artifact = isArtifactCategory(categoryName);
      const categoryId = await one(db, `insert into knowledge.category_observation (model_year_id, source_category, category_key, carcomplaints_complaint_count, nhtsa_complaint_count, source_url, display_status, quarantine_reason) values ($1,$2,$3,$4,$5,$6,$7,$8)
        on conflict (model_year_id, source_category) do update set category_key=excluded.category_key, carcomplaints_complaint_count=excluded.carcomplaints_complaint_count, nhtsa_complaint_count=excluded.nhtsa_complaint_count, source_url=excluded.source_url, display_status=excluded.display_status, quarantine_reason=excluded.quarantine_reason returning id`, [modelYearId, categoryName, normalizedKey(categoryName), count(category.complaint_count, "category complaint count"), count(category.nhtsa_complaint_count, "NHTSA complaint count", true), url(category.url, "category url"), artifact ? "quarantined_artifact" : "eligible", artifact ? "source UI artifact" : null], "category");
      written++; if (artifact) quarantined++; for (const problem of category.problems ?? []) categoryProblems.push({ categoryId, problem });
    }
    for (const batch of chunks(categoryProblems)) {
      const transformed = batch.map(({ categoryId, problem }) => { validateProblem(problem); const incomplete = isStructurallyIncompleteProblem(problem); const sourceUrl = problem.url == null ? null : url(problem.url, "problem url"); return { categoryId, title: string(problem.problem, "problem title"), sourceUrl, incomplete, problem, values: [categoryId, string(problem.problem, "problem title"), count(problem.reports, "problem reports"), count(problem.total_complaints, "total complaints", true), problem.severity?.score ?? null, nullableText(problem.severity?.label), count(problem.repair?.typical_cost_usd, "repair cost", true), nullableText(problem.repair?.raw_cost), count(problem.repair?.average_mileage, "average mileage", true), nullableText(problem.repair?.raw_mileage), nullableText(problem.repair?.mileage_unit), nullableText(problem.faulty_part), nullableText(problem.warranty_note), sourceUrl, incomplete ? "quarantined_incomplete" : "eligible", incomplete ? "missing severity and repair structure" : null] }; });
      const ids = await upsertProblemBatch(db, transformed);
      const solutions: unknown[][] = [];
      for (const item of transformed) { const problemId = ids.get(`${item.categoryId}|${item.title}|${item.sourceUrl ?? "<null>"}`); if (!problemId) throw new Error("aggregate problem RETURNING row could not be mapped"); written++; if (item.incomplete) quarantined++; let ordinal = 0; for (const solution of item.problem.common_solutions ?? []) { ordinal++; solutions.push([problemId, ordinal, string(solution.solution, "solution"), count(solution.reports, "solution reports")]); } }
      for (const solutionBatch of chunks(solutions)) { const solutionPlaceholders = solutionBatch.map((_, row) => `($${row * 4 + 1},$${row * 4 + 2},$${row * 4 + 3},$${row * 4 + 4})`).join(","); await db.query(`insert into knowledge.common_solution (problem_id, source_ordinal, source_solution, reports_count) values ${solutionPlaceholders} on conflict (problem_id, source_ordinal) do update set source_solution=excluded.source_solution, reports_count=excluded.reports_count`, solutionBatch.flat()); written += solutionBatch.length; }
    }
    await db.query(`update knowledge.import_run set last_source_path=$1, rows_read=rows_read+$2, rows_written=rows_written+$3, rows_quarantined=rows_quarantined+$4, phase='load', failure_summary=null where snapshot_id=$5 and run_key=$6`, [path, 1, written, quarantined, state.snapshotId, state.runKey]);
    await db.query("COMMIT");
    return { ...state, lastSourcePath: path, rowsRead: state.rowsRead + 1, rowsWritten: state.rowsWritten + written, rowsQuarantined: state.rowsQuarantined + quarantined };
  } catch (error) { await db.query("ROLLBACK"); throw error; }
}

export async function importSource(filePath: string, client: PgClient, options: { runKey?: string; sampleOnly?: boolean } = {}): Promise<ImportRunState> {
  const source = await stat(filePath); const sha256 = await sha256File(filePath);
  const identity = options.sampleOnly ? { scope: "sample" as const, sampleDefinitionHash: SAMPLE_DEFINITION_HASH } : { scope: "full" as const, sampleDefinitionHash: null };
  const state = await beginImport(client, { name: "CarComplaints.com", bytes: source.size, sha256 }, identity, options.runKey); let current = state; let passedCheckpoint = state.lastSourcePath === null;
  for await (const brand of streamBrands(filePath)) for (const model of brand.models ?? []) for (const year of model.years ?? []) {
    const make = string(brand.brand, "brand"); const modelName = string(model.model, "model"); const numericYear = count(year.year, "model year")!; const path = sourcePath(make, modelName, numericYear);
    if (!passedCheckpoint) { if (path === state.lastSourcePath) passedCheckpoint = true; continue; }
    if (options.sampleOnly && !isRepresentativeSamplePath(make, modelName, numericYear)) continue;
    current = await writeYearForImport(client, current, brand, model, year);
  }
  await client.query(`update knowledge.import_run set phase='complete', finished_at=clock_timestamp() where snapshot_id=$1 and run_key=$2`, [current.snapshotId, current.runKey]);
  await client.query(`update knowledge.source_snapshot set import_status='ready', completed_at=clock_timestamp() where id=$1`, [current.snapshotId]);
  return current;
}

async function main(): Promise<void> { const args = new Set(process.argv.slice(2)); const sourceFlag = process.argv.slice(2).find((arg) => arg.startsWith("--source=")); const source = resolve(sourceFlag?.slice(9) || "data/source/carcomplaints_dataset.json"); if (args.has("--dry-run")) { const result = await dryRun(source, args.has("--sample")); console.log(JSON.stringify({ mode: "dry-run", ...result }, null, 2)); return; } if (!args.has("--write")) throw new Error("select --dry-run or --write"); const connectionString = process.env.AUTOCHECK_SUPABASE_SESSION_POOLER_URL?.trim(); if (!connectionString) throw new Error("AUTOCHECK_SUPABASE_SESSION_POOLER_URL is required for trusted-machine write mode"); const client = new PgClientConstructor({ connectionString }); try { await client.connect(); const runKey = process.argv.slice(2).find((arg) => arg.startsWith("--run-key="))?.slice(10); const state = await importSource(source, client, { sampleOnly: args.has("--sample"), runKey }); console.log(JSON.stringify({ mode: "write", runKey: state.runKey, rowsRead: state.rowsRead, rowsWritten: state.rowsWritten, rowsQuarantined: state.rowsQuarantined }, null, 2)); } finally { await client.end(); } }
if (require.main === module) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "knowledge importer failed"); process.exitCode = 1; });
