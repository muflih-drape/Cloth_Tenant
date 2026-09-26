import { orderApi } from "@/lib/api/order";

let cachedViewedIds: Set<number> | null = null;

export async function fetchViewedOrderIds(): Promise<Set<number>> {
    if (cachedViewedIds) return cachedViewedIds;
    const ids = await orderApi.getViewedIds();
    cachedViewedIds = new Set(ids);
    return cachedViewedIds;
}

export function clearViewedCache() {
    cachedViewedIds = null;
}

export async function markOrderAsViewed(orderId: number) {
    await orderApi.markAsViewed(orderId);
    if (cachedViewedIds) cachedViewedIds.add(orderId);
}

export function getViewedOrdersCount(
    orderIds: number[],
    viewedIds: Set<number>,
): number {
    return orderIds.filter((id) => !viewedIds.has(id)).length;
}

export function getUnreadIds(
    orderIds: number[],
    viewedIds: Set<number>,
): number[] {
    return orderIds.filter((id) => !viewedIds.has(id));
}
