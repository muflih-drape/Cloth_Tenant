import { describe, it, expect } from "vitest";
import type { OrderItem } from "../../types/order";
import {
  isOrderItemFullyPacked,
  sortOrderItemsUnpackedFirst,
} from "../../lib/utils/orderItemSort";

function makeItem(
  id: number,
  quantity: number,
  packedQuantity: number,
  pieceCount = 1,
): OrderItem {
  return {
    id,
    quantity,
    packed_quantity: packedQuantity,
    piece_count: pieceCount,
  } as OrderItem;
}

const ids = (items: OrderItem[]) => items.map((item) => item.id);

describe("isOrderItemFullyPacked", () => {
  it("is false when nothing is packed", () => {
    expect(isOrderItemFullyPacked(makeItem(1, 3, 0))).toBe(false);
  });

  it("is false when packing is partial", () => {
    expect(isOrderItemFullyPacked(makeItem(1, 3, 2))).toBe(false);
  });

  it("is true when packed equals total pieces", () => {
    expect(isOrderItemFullyPacked(makeItem(1, 2, 4, 2))).toBe(true);
  });

  it("is true when packed exceeds total pieces", () => {
    expect(isOrderItemFullyPacked(makeItem(1, 2, 5, 2))).toBe(true);
  });
});

describe("sortOrderItemsUnpackedFirst", () => {
  it("puts unpacked items first, packing items last, stable within groups", () => {
    const items = [
      makeItem(1, 2, 0),
      makeItem(2, 1, 1),
      makeItem(3, 1, 0),
      makeItem(4, 2, 4, 2),
    ];

    expect(ids(sortOrderItemsUnpackedFirst(items))).toEqual([1, 3, 2, 4]);
  });

  it("keeps an all-packed list unchanged", () => {
    const items = [makeItem(5, 1, 1), makeItem(6, 2, 2)];
    expect(ids(sortOrderItemsUnpackedFirst(items))).toEqual([5, 6]);
  });

  it("keeps an all-unpacked list unchanged", () => {
    const items = [makeItem(7, 3, 0), makeItem(8, 1, 0)];
    expect(ids(sortOrderItemsUnpackedFirst(items))).toEqual([7, 8]);
  });

  it("treats partially packed items as unpacked (group A)", () => {
    const items = [
      makeItem(1, 1, 1),
      makeItem(2, 3, 2),
      makeItem(3, 2, 0),
    ];

    expect(ids(sortOrderItemsUnpackedFirst(items))).toEqual([2, 3, 1]);
  });

  it("does not mutate the input array", () => {
    const items = [makeItem(1, 1, 1), makeItem(2, 1, 0)];
    const before = ids(items);

    const result = sortOrderItemsUnpackedFirst(items);

    expect(ids(items)).toEqual(before);
    expect(result).not.toBe(items);
  });

  it("returns an empty array for an empty input", () => {
    expect(sortOrderItemsUnpackedFirst([])).toEqual([]);
  });
});
