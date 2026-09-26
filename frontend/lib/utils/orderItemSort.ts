import type { OrderItem } from "@/types/order";
import { toMeters } from "@/types/item";

/**
 * Whether packing has satisfied this line in full. A line still owed metres is
 * unfinished work, and the packing board should show it first.
 */
export function isOrderItemFullyPacked(item: OrderItem): boolean {
  return toMeters(item.allocated_quantity) >= toMeters(item.ordered_quantity);
}

/** Metres of this line that packing has not yet handed over. */
export function outstandingMeters(item: OrderItem): number {
  const gap = toMeters(item.ordered_quantity) - toMeters(item.allocated_quantity);
  return gap > 0 ? gap : 0;
}

/**
 * Returns a new array with unfulfilled lines first and settled ones last.
 * Stable: lines inside each group keep their original relative order.
 * Never mutates `items`.
 */
export function sortOrderItemsUnpackedFirst(items: OrderItem[]): OrderItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const groupDiff =
        (isOrderItemFullyPacked(a.item) ? 1 : 0) -
        (isOrderItemFullyPacked(b.item) ? 1 : 0);
      if (groupDiff !== 0) return groupDiff;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}
