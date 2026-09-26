/**
 * Variant ordering inside an expanded item, mirroring the mobile rule
 * (`mobile/lib/features/items/display_order.dart`): numeric ascending by
 * display_order, null/blank/non-numeric sorted last (they compare equal and keep
 * server order, thanks to a stable sort).
 */
export function variantOrderValue(
  displayOrder: string | number | null | undefined,
): number {
  const parsed = Number.parseInt(String(displayOrder ?? ""), 10);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

export function compareByVariantOrder(
  a: { display_order?: string | number | null },
  b: { display_order?: string | number | null },
): number {
  return variantOrderValue(a.display_order) - variantOrderValue(b.display_order);
}