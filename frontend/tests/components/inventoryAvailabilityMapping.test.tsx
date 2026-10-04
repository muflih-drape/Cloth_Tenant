import { describe, it, expect } from "vitest";
import { normalizeAdminItem } from "@/components/pages/admin/items/ListItems";
import type { FabricStockEntry } from "@/types/item";

/**
 * The Inventory page reads `/api/items/stock-list/` and rebuilds each colour
 * through this mapper.
 *
 * It is the step where the orderable figure was being dropped: the endpoint sent
 * it, the mapper did not copy it, and every card fell back to showing the shelf
 * total -- which made it look as though placing an order changed nothing.
 */
function entry(available: string): FabricStockEntry {
  return {
    id: 1,
    name: "Cotton Cambric 140 GSM",
    price_per_meter: "9.00",
    image: null,
    variants: [
      {
        id: 7,
        qr_code: "FABRICQRCOD",
        image: null,
        display_order: "Natural",
        stock_meters: "3000.000",
        available_meters: available,
      },
    ],
  };
}

describe("Inventory list mapping", () => {
  it("carries the orderable figure through to the card", () => {
    const item = normalizeAdminItem(entry("2500.000"));

    expect(item.variants[0].available_meters).toBe("2500.000");
    expect(item.variants[0].stock_meters).toBe("3000.000");
  });

  it("carries a negative figure through unchanged", () => {
    const item = normalizeAdminItem(entry("-400.000"));

    expect(item.variants[0].available_meters).toBe("-400.000");
  });

  it("leaves it undefined rather than inventing one when the server omits it", () => {
    const without = entry("100.000");
    delete (without.variants[0] as { available_meters?: string }).available_meters;

    const item = normalizeAdminItem(without);

    expect(item.variants[0].available_meters).toBeUndefined();
    expect(item.variants[0].stock_meters).toBe("3000.000");
  });
});