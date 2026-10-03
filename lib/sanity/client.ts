import {createClient, type PatchOperations, type SanityClient} from "@sanity/client";

/** Keep the API version in one place so reads and writes use the same semantics. */
export const SANITY_API_VERSION = "2026-10-01";

/** Stable singleton that records whether commerce data has ever gone live. */
export const COMMERCE_STATE_DOCUMENT_ID = "tessom-commerce-state";
export const COMMERCE_STATE_ID = COMMERCE_STATE_DOCUMENT_ID;
export const COMMERCE_STATE_TYPE = "commerceState";

export type SanityEnvironment = Readonly<Record<string, string | undefined>>;

export interface SanityReadClient {
  fetch<Result>(query: string, params?: Record<string, unknown>): Promise<Result>;
}

/** The direct document endpoint is read-after-write consistent for keyed IDs. */
export interface SanityDocumentReadClient {
  getDocument<Result extends Record<string, unknown> = Record<string, unknown>>(
    documentId: string,
  ): Promise<Result | null | undefined>;
}

export interface SanityTransaction {
  create(document: Record<string, unknown>): unknown;
  /** Supported by the Sanity transaction API. Optional for read/workflow test doubles that never use it. */
  createIfNotExists?(document: Record<string, unknown>): unknown;
  patch(documentId: string, patch: PatchOperations): unknown;
  commit(): Promise<unknown>;
}

/**
 * The small part of the Sanity client used by the order persistence boundary.
 * Keeping this interface separate makes transaction shape tests independent of
 * the network client and keeps the route from depending on Sanity internals.
 */
export interface SanityPersistenceClient extends SanityReadClient {
  transaction(): SanityTransaction;
}

function requiredEnvironmentValue(environment: SanityEnvironment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    // Never include the missing value, or any other environment value, in the
    // error. These errors can safely reach a server log or route response.
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Construct the write capable Sanity client used by server route handlers.
 * This function intentionally reads the environment at call time, which keeps
 * tests and separate deployments from sharing stale configuration.
 */
export function createSanityServerClient(
  environment: SanityEnvironment = process.env,
): SanityClient & SanityPersistenceClient & SanityDocumentReadClient {
  const projectId = requiredEnvironmentValue(environment, "NEXT_PUBLIC_SANITY_PROJECT_ID");
  const dataset = requiredEnvironmentValue(environment, "NEXT_PUBLIC_SANITY_DATASET");
  const token = requiredEnvironmentValue(environment, "SANITY_API_WRITE_TOKEN");

  return createClient({
    projectId,
    dataset,
    token,
    apiVersion: SANITY_API_VERSION,
    useCdn: false,
  }) as SanityClient & SanityPersistenceClient;
}

export const getSanityServerClient = createSanityServerClient;
