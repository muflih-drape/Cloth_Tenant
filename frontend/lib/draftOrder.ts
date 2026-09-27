import { orderApi } from "@/lib/api/order";
import {
  buildAgentOrderCreatePayload,
  buildOrderCreatePayload,
} from "@/lib/orderFlow";
import type { OrderResponse } from "@/types/order";

/**
 * The wizard identifies the order it is editing through this one key, so it has
 * to be written *before* the wizard is allowed to mount. Every entry point that
 * starts or reopens a draft therefore goes through `createDraftOrder` rather
 * than pushing the route and storing the id afterwards -- navigating first let
 * the wizard read the previous order's id and show the previous order's lines.
 */
const DRAFT_ORDER_KEY = "orderKey";

function readDraftOrderKey(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(DRAFT_ORDER_KEY);
}

export function readDraftOrderId(): number | null {
  const raw = readDraftOrderKey();
  if (!raw) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function persistDraftOrderId(
  orderId: number | null | undefined,
): void {
  if (typeof window === "undefined") return;
  if (orderId) {
    window.localStorage.setItem(DRAFT_ORDER_KEY, String(orderId));
  } else {
    window.localStorage.removeItem(DRAFT_ORDER_KEY);
  }
}

/**
 * Create a draft for the customer and record it as the active order.
 *
 * `agentId` is only needed by an admin: the server assigns the signed-in
 * agent's own record to an agent-created order, so agents must not send one.
 * Resolves only after the order exists, so callers may navigate immediately.
 */
export async function createDraftOrder(
  customerId: number,
  agentId?: number,
): Promise<OrderResponse> {
  const order = await orderApi.create(
    agentId === undefined
      ? buildAgentOrderCreatePayload(customerId)
      : buildOrderCreatePayload(customerId, agentId),
  );
  persistDraftOrderId(order.id);
  return order;
}
