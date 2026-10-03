/** Sanity document IDs accepted by the persistence and workflow adapters. */
export const SANITY_DOCUMENT_ID_PATTERN = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isSanityDocumentId(value: unknown): value is string {
  return typeof value === "string" && SANITY_DOCUMENT_ID_PATTERN.test(value.trim());
}
