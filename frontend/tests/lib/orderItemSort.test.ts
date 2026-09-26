import { describe, it, expect } from "vitest";
import type { OrderItem } from "../../types/order";
import {
  isOrderItemFullyPacked,
  outstandingMeters,
  sortOrderItemsUnpackedFirst,
} from "../../lib/utils/orderItemSort";

/** Metre strings on purpose: the API sends decimals, not numbers. */
function makeItem(id: number, ordered: string, allocated: string): OrderItem {
  return {
    id,
    ordered_quantity: ordered,
    allocated_quantity: allocated,
    outstanding_quantity: String(Number(ordered) - Number(allocated)),
  } as OrderItem;
}

const ids = (items: OrderItem[]) => items.map((item) => item.id);

describe("isOrderItemFullyPacked", () => {
  it("is false when nothing is packed", () => {
    expect(isOrderItemFullyPacked(makeItem(1, "30", "0"))).toBe(false);
  });

  it("is false when packing is partial", () => {
    expect(isOrderItemFullyPacked(makeItem(1, "30", "20"))).toBe(false);
  });

  it("is true when allocated equals ordered", () => {
    expect(isOrderItemFullyPacked(makeItem(1, "25", "25"))).toBe(true);
  });

  it("is true when allocated exceeds ordered", () => {
    expect(isOrderItemFullyPacked(makeItem(1, "25", "30"))).toBe(true);
  });

  it("handles fractional metres without rounding either side", () => {
    expect(isOrderItemFullyPacked(makeItem(1, "10.5", "10.5"))).toBe(true);
    expect(isOrderItemFullyPacked(makeItem(1, "10.5", "10.4"))).toBe(false);
  });
});

describe("outstandingMeters", () => {
  it("is the gap between ordered and allocated", () => {
    expect(outstandingMeters(makeItem(1, "30", "12.5"))).toBe(17.5);
  });

  it("never goes negative when over-allocated", () => {
    expect(outstandingMeters(makeItem(1, "30", "30"))).toBe(0);
    expect(outstandingMeters(makeItem(1, "30", "35"))).toBe(0);
  });
});

describe("sortOrderItemsUnpackedFirst", () => {
  it("puts unpacked lines first, packed lines last, stable within groups", () => {
    const items = [
      makeItem(1, "20", "0"),
      makeItem(2, "10", "10"),
      makeItem(3, "10", "0"),
      makeItem(4, "40", "40"),
    ];

    expect(ids(sortOrderItemsUnpackedFirst(items))).toEqual([1, 3, 2, 4]);
  });

  it("keeps an all-packed list unchanged", () => {
    const items = [makeItem(5, "10", "10"), makeItem(6, "20", "20")];
    expect(ids(sortOrderItemsUnpackedFirst(items))).toEqual([5, 6]);
  });

  it("keeps an all-unpacked list unchanged", () => {
    const items = [makeItem(7, "30", "0"), makeItem(8, "10", "0")];
    expect(ids(sortOrderItemsUnpackedFirst(items))).toEqual([7, 8]);
  });

  it("treats partially packed lines as unpacked (group A)", () => {
    const items = [
      makeItem(1, "10", "10"),
      makeItem(2, "30", "20"),
      makeItem(3, "20", "0"),
    ];

    expect(ids(sortOrderItemsUnpackedFirst(items))).toEqual([2, 3, 1]);
  });

  it("does not mutate the input array", () => {
    const items = [makeItem(1, "10", "10"), makeItem(2, "10", "0")];
    const before = ids(items);

    const result = sortOrderItemsUnpackedFirst(items);

    expect(ids(items)).toEqual(before);
    expect(result).not.toBe(items);
  });

  it("returns an empty array for an empty input", () => {
    expect(sortOrderItemsUnpackedFirst([])).toEqual([]);
  });
});
