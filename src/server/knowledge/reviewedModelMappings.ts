/**
 * Reviewed semantic mappings. This manifest is documentation and regression
 * input; runtime resolution reads only the corresponding server-side database
 * rows seeded by forward-only migrations.
 */
export const REVIEWED_MODEL_MAPPINGS = [
  {
    snapshotSha256: "2617b681a5113a238e0f4920a8e561e8a4ce351206e528ce1cace082be17425f",
    makeKey: "subaru",
    canonicalModel: { name: "WRX", key: "wrx", reviewStatus: "approved" },
    sourceModels: [
      { name: "Impreza WRX", key: "imprezawrx", years: [2009, 2014] },
      { name: "WRX", key: "wrx", years: [2015, 2022] },
    ],
    aliases: [
      { value: "WRX", key: "wrx", kind: "reviewed_alias", validFromYear: 2009, validToYear: 2014 },
    ],
    excludedSourceModels: ["Impreza", "Impreza WRX STI", "WRX STI"],
    rationale: "CarComplaints stores the reviewed non-STI Subaru WRX family as Impreza WRX for 2009–2014 and WRX for 2015–2022. Plain Impreza and STI variants remain distinct.",
  },
] as const;
