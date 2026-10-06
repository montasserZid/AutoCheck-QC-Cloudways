import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeKnowledgeKey } from "../src/lib/knowledgeNormalization";
import { FREE_QUICK_CHECK_LIMITS, validateFreeQuickCheckRequest } from "../src/lib/freeQuickCheck";
import { requestFreeQuickCheck } from "../src/lib/freeQuickCheckClient";
import { createFreeQuickCheckPostHandler } from "../src/server/freeQuickCheck/handler";
import { toFreeQuickCheckResponse } from "../src/server/knowledge/freeQuickCheckService";

const listingId = "550e8400-e29b-41d4-a716-446655440000";
const submissionKey = "550e8400-e29b-41d4-a716-846655440000";
const vehicle = { year: 2018, make: "Honda", model: "Civic", trim: "EX" };

test("knowledge normalization matches importer parity fixtures", () => {
  assert.equal(normalizeKnowledgeKey("CX-5"), "cx5");
  assert.equal(normalizeKnowledgeKey("  H\u00d4NDA   HR-V "), "hondahrv");
  assert.equal(normalizeKnowledgeKey("RS 3"), "rs3");
});

test("Free request validation rejects malformed IDs and unknown fields", () => {
  assert.equal(validateFreeQuickCheckRequest({ listingId, submissionKey }).ok, true);
  assert.equal(validateFreeQuickCheckRequest({ listingId: "bad", submissionKey }).ok, false);
  assert.equal(validateFreeQuickCheckRequest({ listingId, submissionKey, make: "Honda" }).ok, false);
});

test("Free client serializes only the listing proof fields", async () => {
  const browserListingId = "93ecf28d-5f0a-4566-97d9-94f99d06bc6a";
  const browserSubmissionKey = "554b2d63-c8b0-44cc-beb8-775a6722a744";
  assert.equal(validateFreeQuickCheckRequest({ listingId: browserListingId, submissionKey: browserSubmissionKey }).ok, true);
  const submittedContext = { listingId: browserListingId, submissionKey: browserSubmissionKey, vehicleId: "79092863-ea02-44d3-809f-6b9937b64859", replayed: false };
  let sentBody = "";
  await requestFreeQuickCheck(
    submittedContext,
    async (_input, init) => {
      sentBody = String(init?.body);
      return Response.json({ ok: true, report: { vehicle, coverage: { status: "limited", label: "Historical data for this model-year is limited" }, historicalSignal: null, topHistoricalAreas: [], headlines: [], lockedSummary: null } });
    },
  );
  assert.deepEqual(JSON.parse(sentBody), { listingId: browserListingId, submissionKey: browserSubmissionKey });
});

test("matched Free DTO is bounded, ordered, and has no signal", () => {
  const response = toFreeQuickCheckResponse({
    outcome: "matched", vehicle, eligibleCategoryCount: 4,
    areas: [
      { name: "Engine", complaintCount: 12 }, { name: "Transmission", complaintCount: 10 },
      { name: "Electrical", complaintCount: 2 }, { name: "Suspension", complaintCount: 1 },
    ], additionalHistoricalDetailAvailable: true,
  });
  assert.equal(response.historicalSignal, null);
  assert.equal(response.topHistoricalAreas.length, 3);
  assert.equal(response.headlines.length, 3);
  assert.equal(JSON.stringify(response).includes("source_problem_title"), false);
  assert.equal(JSON.stringify(response).includes("nhtsa"), false);
});

test("limited and ambiguous results never become low", () => {
  for (const outcome of ["limited", "ambiguous"] as const) {
    const response = toFreeQuickCheckResponse({ outcome, vehicle, eligibleCategoryCount: 0, areas: [], additionalHistoricalDetailAvailable: false });
    assert.equal(response.historicalSignal, null);
    assert.equal(response.topHistoricalAreas.length, 0);
  }
  assert.equal(toFreeQuickCheckResponse({ outcome: "ambiguous", vehicle, eligibleCategoryCount: 0, areas: [], additionalHistoricalDetailAvailable: false }).coverage.status, "unavailable");
});

test("Free handler uses only listing proof and hides repository failures", async () => {
  const handler = createFreeQuickCheckPostHandler({
    async lookup(id, key) {
      assert.equal(id, listingId); assert.equal(key, submissionKey);
      return { outcome: "limited", vehicle, eligibleCategoryCount: 0, areas: [], additionalHistoricalDetailAvailable: false };
    },
  }, () => undefined);
  const ok = await handler(new Request("http://localhost/api/free-quick-check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId, submissionKey }) }));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).report.historicalSignal, null);
  const bad = await handler(new Request("http://localhost/api/free-quick-check", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }));
  assert.equal(bad.status, 400);
  const wrongType = await handler(new Request("http://localhost/api/free-quick-check", { method: "POST", body: JSON.stringify({ listingId, submissionKey }) }));
  assert.equal(wrongType.status, 415);
  const unknown = await handler(new Request("http://localhost/api/free-quick-check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId, submissionKey, model: "Civic" }) }));
  assert.equal(unknown.status, 400);
  const oversized = await handler(new Request("http://localhost/api/free-quick-check", { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(FREE_QUICK_CHECK_LIMITS.bodyBytes + 1) }));
  assert.equal(oversized.status, 413);
});

test("invalid or mismatched listing proof is not treated as a knowledge result", async () => {
  const handler = createFreeQuickCheckPostHandler({ async lookup() { return null; } }, () => undefined);
  const response = await handler(new Request("http://localhost/api/free-quick-check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId, submissionKey }) }));
  assert.equal(response.status, 404);
});

test("Free handler returns a safe database failure", async () => {
  const handler = createFreeQuickCheckPostHandler({ async lookup() { throw new Error("knowledge.source_snapshot SQL detail"); } }, () => undefined);
  const response = await handler(new Request("http://localhost/api/free-quick-check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId, submissionKey }) }));
  assert.equal(response.status, 503);
  assert.doesNotMatch(JSON.stringify(await response.json()), /knowledge\.source_snapshot|SQL detail/);
});
