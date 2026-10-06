/** Must remain equivalent to scripts/knowledge/importer.ts normalizedKey(). */
export function normalizeKnowledgeKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9]/g, "");
}
