/**
 * Shared image upload sizing rules.
 *
 * Phone cameras produce 8-16MP photos (3-8 MB). Uploading those originals
 * through the deployed reverse proxy trips its default `client_max_body_size`
 * (1 MB) and the browser only sees an opaque "Network Error". Every client-side
 * image path funnels through here so uploads stay small and predictable.
 */

export const MAX_UPLOAD_SIDE = 1600;
export const JPEG_QUALITY = 0.85;

export interface ShrinkSize {
  width: number;
  height: number;
  /** True when the source was larger than `maxSide` and had to be scaled. */
  scaled: boolean;
}

/**
 * Compute the target dimensions for an image so its longest side is at most
 * `maxSide`, preserving the aspect ratio. Never upscales.
 */
export function computeShrinkSize(
  width: number,
  height: number,
  maxSide: number = MAX_UPLOAD_SIDE,
): ShrinkSize {
  if (width <= 0 || height <= 0) {
    return { width: 0, height: 0, scaled: false };
  }

  const longest = Math.max(width, height);
  if (longest <= maxSide) {
    return { width, height, scaled: false };
  }

  const scale = maxSide / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scaled: true,
  };
}
