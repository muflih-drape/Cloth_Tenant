import { describe, it, expect } from "vitest";
import {
  computeInventorySummary,
  matchesStockFilter,
  LOW_STOCK_METERS,
} from "../../lib/utils/inventorySummary";

/** Metre strings on purpose: Django sends decimals as strings. */
function makeFabric(
  id: number,
  name: string,
  rate: string,
  stock: string[],
): {
  id: number;
  name: string;
  price_per_meter: string;
  variants: { stock_meters: string }[];
} {
  return {
    id,
    name,
    price_per_meter: rate,
    variants: stock.map((stock_meters) => ({ stock_meters })),
  };
}

describe("computeInventorySummary", () => {
  it("sums metres and values them at the rate per metre", () => {
    const summary = computeInventorySummary([
      makeFabric(1, "Cotton", "150", ["40", "20"]),
    ]);

    expect(summary.totalStock).toBe(60);
    expect(summary.totalValue).toBe(9000); // 60 m × ₹150
    expect(summary.fabricCount).toBe(1);
  });

  it("keeps fractional metres rather than rounding to whole units", () => {
    const summary = computeInventorySummary([
      makeFabric(1, "Silk", "100", ["12.5", "0.25"]),
    ]);

    expect(summary.totalStock).toBe(12.75);
    expect(summary.totalValue).toBe(1275);
  });

  it("flags a colour as low only when it is empty-but-not-below threshold", () => {
    const summary = computeInventorySummary([
      makeFabric(1, "Linen", "100", [String(LOW_STOCK_METERS - 1), "0"]),
    ]);
    const row = summary.fabricSummaries[0];

    expect(row.lowStockVariants).toBe(1);
    expect(row.outOfStockVariants).toBe(1);
    // One colour has stock, so the fabric is not sold out.
    expect(summary.outOfStockCount).toBe(0);
  });

  it("does not count a colour at exactly the threshold as low", () => {
    const summary = computeInventorySummary([
      makeFabric(1, "Denim", "100", [String(LOW_STOCK_METERS)]),
    ]);

    expect(summary.fabricSummaries[0].lowStockVariants).toBe(0);
    expect(summary.lowStockCount).toBe(0);
  });

  it("counts a fabric as sold out only when every colour is empty", () => {
    const summary = computeInventorySummary([
      makeFabric(1, "Empty", "100", ["0", "0"]),
      makeFabric(2, "Partly", "100", ["0", "5"]),
    ]);

    expect(summary.outOfStockCount).toBe(1);
  });

  it("treats a fabric with no colours as not sold out", () => {
    const summary = computeInventorySummary([makeFabric(1, "Bare", "100", [])]);

    expect(summary.outOfStockCount).toBe(0);
    expect(summary.fabricSummaries[0].totalStock).toBe(0);
  });

  it("survives an unparseable rate without producing NaN", () => {
    const summary = computeInventorySummary([
      makeFabric(1, "Broken", "", ["10"]),
    ]);

    expect(Number.isNaN(summary.totalValue)).toBe(false);
    expect(summary.totalValue).toBe(0);
  });

  it("handles an empty catalogue", () => {
    const summary = computeInventorySummary([]);

    expect(summary.totalStock).toBe(0);
    expect(summary.totalValue).toBe(0);
    expect(summary.fabricCount).toBe(0);
  });
});

describe("matchesStockFilter", () => {
  const summary = computeInventorySummary([
    makeFabric(1, "Healthy", "100", ["500"]),
    makeFabric(2, "Low", "100", ["10"]),
    makeFabric(3, "Gone", "100", ["0"]),
  ]);
  const [healthy, low, gone] = summary.fabricSummaries;

  it("keeps everything on the all filter", () => {
    expect(matchesStockFilter(healthy, "all")).toBe(true);
  });

  it("keeps anything with metres on the roll", () => {
    expect(matchesStockFilter(healthy, "inStock")).toBe(true);
    expect(matchesStockFilter(low, "inStock")).toBe(true);
    expect(matchesStockFilter(gone, "inStock")).toBe(false);
  });

  it("keeps fabrics with a low colour", () => {
    expect(matchesStockFilter(low, "low")).toBe(true);
    expect(matchesStockFilter(healthy, "low")).toBe(false);
  });

  it("keeps only fully-empty fabrics on the sold-out filter", () => {
    expect(matchesStockFilter(gone, "out")).toBe(true);
    expect(matchesStockFilter(low, "out")).toBe(false);
  });
});
