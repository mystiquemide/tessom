import {createClient} from "@sanity/client";

import {SANITY_API_VERSION, type SanityReadClient} from "./client";

/** Token-free read client for the public dataset. Returns null when the project is not configured. */
export function createPublicReadClient(environment: Record<string, string | undefined> = process.env): SanityReadClient | null {
  const projectId = environment.NEXT_PUBLIC_SANITY_PROJECT_ID?.trim();
  const dataset = environment.NEXT_PUBLIC_SANITY_DATASET?.trim() || "production";
  if (!projectId) return null;
  return createClient({projectId, dataset, apiVersion: SANITY_API_VERSION, useCdn: false});
}

export interface PhotoCredit {
  readonly name: string;
  readonly url: string;
}

export const PHOTO_CREDITS_QUERY = `array::unique(*[_type == "sanity.imageAsset" && source.name == "unsplash" && defined(creditLine)]{
  "name": string::split(string::split(creditLine, "Photo by ")[1], " on Unsplash")[0],
  "url": source.url
})`;

/** Photographers behind every Unsplash image in the dataset, for the footer credits. */
export async function fetchPhotoCredits(client: SanityReadClient | null = createPublicReadClient()): Promise<PhotoCredit[]> {
  if (!client) return [];
  try {
    const credits = await client.fetch<PhotoCredit[]>(PHOTO_CREDITS_QUERY);
    const byName = new Map<string, PhotoCredit>();
    for (const credit of credits) {
      if (credit.name && credit.url && !byName.has(credit.name)) byName.set(credit.name, credit);
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}
