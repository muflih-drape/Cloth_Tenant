import type { OrderItem } from "@/types/order";

/**
 * Whether an order item has been packed in full. Items whose `packed_quantity`
 * is below `piece_count * quantity` (including zero) are not fully packed.
 */
export function isOrderItemFullyPacked(item: OrderItem): boolean {
  const totalPieces = (item.piece_count || 1) * item.quantity;
  return (item.packed_quantity ?? 0) >= totalPieces;
}

/**
 * Returns a new array with not-fully-packed items first and fully packed items
 * last. Stable: items inside each group keep their original relative order.
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
