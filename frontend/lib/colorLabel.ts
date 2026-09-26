/**
 * Shared, single fallback for variant `display_order`, which may be null or
 * blank: show the stored value, else the variant's position number (index + 1,
 * matching the web card convention). Never renders `Color #null` / `Color #`.
 */
export function variantColorLabel(
  displayOrder: string | number | null | undefined,
  position: number,
): string {
  const value = String(displayOrder ?? "").trim();
  return value ? `Color #${value}` : `Color #${position}`;
}

/**
 * Suffix for order rows / invoice lines (no position number available there):
 * absent when the variant has no display_order, so we never render
 * `( Color #null )`.
 */
export function orderItemColorSuffix(
  variantDisplayOrder: string | number | null | undefined,
): string {
  const value = String(variantDisplayOrder ?? "").trim();
  return value ? ` ( Color #${value} )` : "";
}