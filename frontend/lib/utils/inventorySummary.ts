import { toMeters } from "@/types/item";

/**
 * A roll below this is flagged as "low" on the inventory summary. It only
 * changes the label, never any stock arithmetic.
 */
export const LOW_STOCK_METERS = 50;

export interface FabricSummaryRow {
  id: number;
  name: string;
  pricePerMeter: number;
  variantCount: number;
  /** Physical metres across every colour. */
  totalStock: number;
  /** totalStock × pricePerMeter. */
  totalValue: number;
  /** Colours with nothing left on the roll. */
  outOfStockVariants: number;
  /** Colours holding some cloth but under the low threshold. */
  lowStockVariants: number;
}

export interface InventorySummary {
  totalStock: number;
  totalValue: number;
  fabricCount: number;
  /** Fabrics where every colour is empty. */
  outOfStockCount: number;
  /** Fabrics with at least one colour under the low threshold. */
  lowStockCount: number;
  fabricSummaries: FabricSummaryRow[];
}

type StockSource = {
  id: number;
  name: string;
  price_per_meter: string;
  variants: { stock_meters: string }[];
};

/**
 * Value the physical cloth on the rolls.
 *
 * Metres come from `stock_meters`, not from order demand: a metre that is spoken
 * for but not yet cut is still on the roll. Value is metres × the fabric's rate
 * per metre, which is the same rate orders are billed at.
 */
export function computeInventorySummary(fabrics: StockSource[]): InventorySummary {
  let totalStock = 0;
  let totalValue = 0;
  let outOfStockCount = 0;
  let lowStockCount = 0;

  const fabricSummaries = fabrics.map((fabric): FabricSummaryRow => {
    const pricePerMeter = Number(fabric.price_per_meter) || 0;
    let stock = 0;
    let outOfStockVariants = 0;
    let lowStockVariants = 0;

    for (const variant of fabric.variants) {
      const meters = toMeters(variant.stock_meters);
      stock += meters;
      if (meters <= 0) outOfStockVariants += 1;
      else if (meters < LOW_STOCK_METERS) lowStockVariants += 1;
    }

    const value = stock * pricePerMeter;
    totalStock += stock;
    totalValue += value;
    if (fabric.variants.length > 0 && outOfStockVariants === fabric.variants.length) {
      outOfStockCount += 1;
    }
    if (lowStockVariants > 0) lowStockCount += 1;

    return {
      id: fabric.id,
      name: fabric.name,
      pricePerMeter,
      variantCount: fabric.variants.length,
      totalStock: stock,
      totalValue: value,
      outOfStockVariants,
      lowStockVariants,
    };
  });

  return {
    totalStock,
    totalValue,
    fabricCount: fabricSummaries.length,
    outOfStockCount,
    lowStockCount,
    fabricSummaries,
  };
}

/** Filter chips on the summary table. */
export type StockFilter = "all" | "inStock" | "low" | "out";

export function matchesStockFilter(row: FabricSummaryRow, filter: StockFilter): boolean {
  switch (filter) {
    case "inStock":
      return row.totalStock > 0;
    case "low":
      return row.lowStockVariants > 0;
    case "out":
      return row.variantCount > 0 && row.outOfStockVariants === row.variantCount;
    default:
      return true;
  }
}
