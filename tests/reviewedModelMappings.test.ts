import { test } from "node:test";
import assert from "node:assert/strict";
import { REVIEWED_MODEL_MAPPINGS } from "../src/server/knowledge/reviewedModelMappings";

test("reviewed Subaru WRX mapping is bounded and excludes Impreza and STI identities", () => {
  const mapping = REVIEWED_MODEL_MAPPINGS[0];
  assert.equal(mapping.makeKey, "subaru");
  assert.deepEqual(mapping.sourceModels, [
    { name: "Impreza WRX", key: "imprezawrx", years: [2009, 2014] },
    { name: "WRX", key: "wrx", years: [2015, 2022] },
  ]);
  assert.deepEqual(mapping.aliases, [
    { value: "WRX", key: "wrx", kind: "reviewed_alias", validFromYear: 2009, validToYear: 2014 },
  ]);
  assert.deepEqual(mapping.excludedSourceModels, ["Impreza", "Impreza WRX STI", "WRX STI"]);
});
