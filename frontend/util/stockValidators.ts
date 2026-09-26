import { UIItem, UIVariant, toMeters } from "@/types/item";

/** A colour with no cloth left. */
export function isVariantOutOfStock(variant: UIVariant): boolean {
  return toMeters(variant.stock_meters) <= 0;
}

/** True when any colour is still available. */
export function hasStock(item: UIItem): boolean {
  return item.variants.some((variant) => !isVariantOutOfStock(variant));
}

/** A fabric is only "out of stock" when every one of its colours is empty. */
export function isItemOutOfStock(item: UIItem): boolean {
  return !hasStock(item);
}

/** Some colours empty, others not -- the badge state in between. */
export function isItemPartiallyOutOfStock(item: UIItem): boolean {
  const out = item.variants.filter(isVariantOutOfStock).length;
  return out > 0 && out < item.variants.length;
}

export function itemStockMeters(item: UIItem): number {
  return item.variants.reduce(
    (total, variant) => total + toMeters(variant.stock_meters),
    0,
  );
}
