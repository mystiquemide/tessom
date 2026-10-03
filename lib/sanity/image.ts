import imageUrlBuilder from "@sanity/image-url";

export interface SanityImageSource {
  asset?: {_ref?: string; _id?: string} | null;
}

/** Sized, auto-format URL for a Sanity image, or null when the document has no image. */
export function sanityImageUrl(
  source: SanityImageSource | null | undefined,
  width: number,
  environment: Record<string, string | undefined> = process.env,
): string | null {
  const projectId = environment.NEXT_PUBLIC_SANITY_PROJECT_ID?.trim();
  const dataset = environment.NEXT_PUBLIC_SANITY_DATASET?.trim() || "production";
  if (!projectId || !source?.asset) return null;
  return imageUrlBuilder({projectId, dataset}).image(source).width(width).auto("format").quality(80).url();
}
