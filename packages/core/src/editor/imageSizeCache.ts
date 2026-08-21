// Natural sizes of loaded embed images, per resolved src. Shared by
// the Live Preview widgets and the rendered-content fill so both modes
// take an image's final box synchronously and scroll anchoring always
// measures a stable layout. A module of its own so the render helpers
// never import the editor — this was the one import cycle between the
// core's layers (m41).
const imageSizeCache = new Map<string, { width: number; height: number }>();

export function cachedImageSize(
  src: string,
): { width: number; height: number } | undefined {
  return imageSizeCache.get(src);
}

/** First loaded size wins; later loads never shift a settled layout. */
export function cacheImageSize(
  src: string,
  size: { width: number; height: number },
): void {
  if (!imageSizeCache.has(src)) {
    imageSizeCache.set(src, size);
  }
}
