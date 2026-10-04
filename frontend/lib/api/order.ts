import type {
  AddOrderItemRequest,
  BundleMutationResponse,
  CreatePackingBundleResponse,
  DispatchResponse,
  MergeOrderItemsRequest,
  OrderAllResponse,
  OrderRegisterRequest,
  OrderRegisterResponse,
  OrderResponse,
  OrderTotals,
  PackingBundleListResponse,
  PackingPlan,
  PackingQueue,
  PackingRoundSummary,
  PackLineResponse,
  PackLineRollOverride,
  PlaceOrderResponse,
  PlanOverrideEntry,
  ScanIntoBundleResponse,
  UpdateOrderItemRequest,
  UpdateOrderRequest,
} from "@/types/order";
import { api } from "./axios";
import type { PaginatedResponse } from "@/types/global";

export interface OrderLog {
  id: number;
  order_ref: number;
  action: string;
  details: Record<string, unknown>;
  performed_by: string | null;
  created_at: string;
}

export interface InvoiceResponse {
  id: number;
  customer: { id: number; name: string; contact: string; address: string };
  agent: { id: number; username: string; contact: string } | null;
  brand?: {
    id: number;
    name: string;
    phone: string;
    email: string;
    address_line1: string;
    address_line2: string | null;
    logo_url: string | null;
    gst: string | null;
  } | null;
  created_at: string;
  status: string;
  items: OrderResponse["items"];
  totals: OrderTotals;
  gst_rate: number;
  lr_number: string;
  notes?: string;
}

export interface PriceOverrideResponse {
  message: string;
  computed_total: string;
  final_total: string | null;
  effective_total: string;
  is_price_overridden: boolean;
  price_override_reason: string;
}

export interface AllocationRecord {
  id: number;
  metres: string;
  sequence: number;
  is_priority_award: boolean;
  created_at: string;
  customer: string;
  fabric: string;
}

export interface ConfirmRoundResponse {
  message: string;
  id: number;
  status: string;
  allocations: AllocationRecord[];
}

export interface OrderFilters {
  from?: string;
  to?: string;
  agent?: string;
  page?: number;
  page_size?: number;
  search?: string;
  customer?: string;
  status?: string[];
}

export const orderApi = {
  getAll(
    filters?: OrderFilters,
  ): Promise<PaginatedResponse<OrderAllResponse[number]>> {
    const params = new URLSearchParams();
    if (filters?.from) params.append("from_date", filters.from);
    if (filters?.to) params.append("to_date", filters.to);
    if (filters?.agent) params.append("agent", filters.agent);
    if (filters?.page) params.append("page", filters.page.toString());
    if (filters?.page_size) params.append("page_size", filters.page_size.toString());
    if (filters?.search) params.append("search", filters.search);
    if (filters?.customer) params.append("customer", filters.customer);
    filters?.status?.forEach((s) => params.append("status", s));
    const query = params.toString();
    return api
      .get<PaginatedResponse<OrderAllResponse[number]>>(
        `/api/orders/${query ? `?${query}` : ""}`,
      )
      .then((r) => r.data);
  },

  getAllIds(): Promise<{ id: number; status: string }[]> {
    return api
      .get<{ id: number; status: string }[]>("/api/orders/order-ids/")
      .then((r) => r.data);
  },

  getByCustomer(
    customerId: number,
    params?: { page?: number; page_size?: number },
  ): Promise<PaginatedResponse<OrderAllResponse[number]>> {
    const query = new URLSearchParams();
    query.append("customer", customerId.toString());
    if (params?.page) query.append("page", params.page.toString());
    if (params?.page_size) query.append("page_size", params.page_size.toString());
    return api
      .get<PaginatedResponse<OrderAllResponse[number]>>(`/api/orders/?${query.toString()}`)
      .then((r) => r.data);
  },

  getOne(id: number): Promise<OrderResponse> {
    return api.get<OrderResponse>(`/api/orders/${id}/`).then((r) => r.data);
  },

  create(data: OrderRegisterRequest): Promise<OrderRegisterResponse> {
    return api.post<OrderRegisterResponse>("/api/orders/", data).then((r) => r.data);
  },

  /** Add a fabric line by scanning its QR and asking for a number of metres. */
  addItem(orderId: number, itemData: AddOrderItemRequest): Promise<void> {
    return api.post(`/api/orders/${orderId}/add-item/`, itemData).then((r) => r.data);
  },

  update(id: number, data: UpdateOrderRequest): Promise<OrderResponse> {
    return api.patch<OrderResponse>(`/api/orders/${id}/`, data).then((r) => r.data);
  },

  updateItem(itemId: number, data: UpdateOrderItemRequest) {
    return api.patch(`/api/orders/order-items/${itemId}/`, data).then((r) => r.data);
  },

  delete(id: number, pin: string): Promise<void> {
    return api.delete(`/api/orders/${id}/`, { data: { pin } }).then((r) => r.data);
  },

  agentDelete(id: number): Promise<void> {
    return api.delete(`/api/orders/${id}/`).then((r) => r.data);
  },

  deleteItem(orderId: number, itemId: number): Promise<void> {
    return api.delete(`/api/orders/${orderId}/delete-item/${itemId}/`).then((r) => r.data);
  },

  /**
   * Fold duplicate lines into one. Done server-side in a single transaction so
   * the metres are summed as decimals and a failure cannot leave the order
   * holding the group's metres twice.
   */
  mergeItems(orderId: number, data: MergeOrderItemsRequest): Promise<void> {
    return api
      .post(`/api/orders/${orderId}/merge-items/`, data)
      .then((r) => r.data);
  },

  invoiceOrder(id: number): Promise<InvoiceResponse> {
    return api.get<InvoiceResponse>(`/api/orders/${id}/invoice/`).then((r) => r.data);
  },

  /**
   * Turn a DRAFT into real demand. The response lists any `shortfall_lines`:
   * variants where every open order together wants more than the mill holds.
   * That is allowed on purpose -- packing arbitrates the oversubscription.
   */
  placeOrder(
    id: number,
    data?: {
      expected_delivery_date?: string | null;
      preferred_transport?: number | null;
      notes?: string | null;
    },
  ): Promise<PlaceOrderResponse> {
    return api
      .post<PlaceOrderResponse>(`/api/orders/${id}/place-order/`, data)
      .then((r) => r.data);
  },

  /**
   * Ship an order. Rejected while any line is unallocated, unless
   * `allow_partial` is set -- which then also requires a `shortfall_reason`,
   * because shipping short is a decision someone has to own.
   */
  dispatchOrder(
    id: number,
    data?: {
      transport_company?: number | null;
      lr_number?: string;
      allow_partial?: boolean;
      shortfall_reason?: string;
    },
  ): Promise<DispatchResponse> {
    return api.post<DispatchResponse>(`/api/orders/${id}/dispatch/`, data).then((r) => r.data);
  },

  /**
   * Set or clear the billed total of a draft order. Posting the computed total
   * clears an existing adjustment. `reason` is optional but always audited.
   * The server caps an agent at the line arithmetic; only an admin may raise it.
   */
  setPrice(
    id: number,
    data: { final_total: string; reason?: string },
  ): Promise<PriceOverrideResponse> {
    return api.post<PriceOverrideResponse>(`/api/orders/${id}/set-price/`, data).then((r) => r.data);
  },

  getOrderLogs(orderId: number): Promise<OrderLog[]> {
    return api.get<OrderLog[]>(`/api/orders/${orderId}/logs/`).then((r) => r.data);
  },

  startEdit(id: number): Promise<{ message: string }> {
    return api.post<{ message: string }>(`/api/orders/${id}/start-edit/`).then((r) => r.data);
  },

  saveEdit(
    id: number,
    data?: {
      expected_delivery_date?: string | null;
      preferred_transport?: number | null;
      notes?: string | null;
    },
  ): Promise<{ message: string; order_id: number }> {
    return api
      .post<{ message: string; order_id: number }>(`/api/orders/${id}/save-edit/`, data)
      .then((r) => r.data);
  },

  cancelEdit(id: number): Promise<{ message: string }> {
    return api.post<{ message: string }>(`/api/orders/${id}/cancel-edit/`).then((r) => r.data);
  },

  getViewedIds(): Promise<number[]> {
    return api.get<number[]>("/api/orders/my-viewed-ids/").then((r) => r.data);
  },

  markAsViewed(orderId: number): Promise<void> {
    return api.post(`/api/orders/${orderId}/mark-viewed/`).then((r) => r.data);
  },

  getArchived(
    filters?: OrderFilters,
  ): Promise<PaginatedResponse<OrderAllResponse[number]>> {
    const params = new URLSearchParams();
    if (filters?.from) params.append("from_date", filters.from);
    if (filters?.to) params.append("to_date", filters.to);
    if (filters?.page) params.append("page", filters.page.toString());
    if (filters?.page_size) params.append("page_size", filters.page_size.toString());
    const query = params.toString();
    return api
      .get<PaginatedResponse<OrderAllResponse[number]>>(
        `/api/orders/archived/${query ? `?${query}` : ""}`,
      )
      .then((r) => r.data);
  },
};

/**
 * The packing board. One fabric variant at a time: see who is waiting for it,
 * dry-run the equal-fill + priority split, freeze the plan, then confirm it to
 * move cloth (or cancel it to put the metres back).
 */
export const packingApi = {
  /** Outstanding demand for one variant, ranked by customer priority. */
  queue(variantId: number): Promise<PackingQueue> {
    return api
      .get<PackingQueue>("/api/orders/packing-rounds/queue/", {
        params: { variant: variantId },
      })
      .then((r) => r.data);
  },

  /** Run the allocation engine without writing anything. */
  preview(data: {
    variant: number;
    round_size: string;
    order_ids?: number[];
    available_meters?: string | null;
  }): Promise<PackingPlan> {
    return api.post<PackingPlan>("/api/orders/packing-rounds/preview/", data).then((r) => r.data);
  },

  /**
   * Freeze a plan as a DRAFT round. Omit `allocations` to accept the engine's
   * own split, or send a hand-edited plan to override it.
   */
  createRound(data: {
    variant: number;
    round_size: string;
    note?: string;
    allocations?: PlanOverrideEntry[];
  }): Promise<{ id: number; status: string; plan_override: PlanOverrideEntry[] }> {
    return api.post("/api/orders/packing-rounds/", data).then((r) => r.data);
  },

  listRounds(variantId?: number): Promise<PackingRoundSummary[]> {
    return api
      .get<PackingRoundSummary[]>("/api/orders/packing-rounds/list/", {
        params: variantId ? { variant: variantId } : undefined,
      })
      .then((r) => r.data);
  },

  /** Commit the round: cloth leaves the roll and allocations are recorded. */
  confirm(roundId: number, note?: string): Promise<ConfirmRoundResponse> {
    return api
      .post<ConfirmRoundResponse>(`/api/orders/packing-rounds/${roundId}/confirm/`, {
        note: note ?? "",
      })
      .then((r) => r.data);
  },

  /** Reverse a confirmed round, returning its metres to the roll. */
  cancel(roundId: number): Promise<{ message: string; id: number; status: string }> {
    return api
      .post<{ message: string; id: number; status: string }>(
        `/api/orders/packing-rounds/${roundId}/cancel/`,
        {},
      )
      .then((r) => r.data);
  },

  /**
   * Pack one order line from the order page, without opening the board.
   *
   * This really does move cloth, so the server builds a one-entry packing round
   * and confirms it through the same engine the board uses: same stock rules,
   * same Allocation row, same ALLOCATION_MADE log entry, and a round that can
   * still be cancelled if the admin changes their mind.
   *
   * For a colour tracked by physical rolls the server refuses this without a
   * `rolls` breakdown rather than guessing which cloth to cut -- scan the roll into a
   * bundle instead (see `scanIntoBundle`), since the roll's label already says
   * which roll it is.
   */
  packLine(
    orderId: number,
    itemId: number,
    metres: string,
    rolls?: PackLineRollOverride[],
  ): Promise<PackLineResponse> {
    return api
      .post<PackLineResponse>(`/api/orders/${orderId}/items/${itemId}/pack/`, {
        metres,
        // Omitted entirely for a colour with no rolls, whose stock is one figure.
        ...(rolls && rolls.length > 0 ? { rolls } : {}),
      })
      .then((r) => r.data);
  },

  /**
   * Every bundle on this order, sealed ones included. Sealed bundles keep their
   * rolls in the response, which is what lets a packing slip be reprinted long
   * after the box has gone.
   */
  listBundles(orderId: number): Promise<PackingBundleListResponse> {
    return api
      .get<PackingBundleListResponse>(`/api/orders/${orderId}/bundles/`)
      .then((r) => r.data);
  },

  /**
   * Open a new empty bundle on this order. Nothing is fixed yet: rolls can be
   * scanned in and taken back out until it is sealed.
   */
  createBundle(orderId: number): Promise<CreatePackingBundleResponse> {
    return api
      .post<CreatePackingBundleResponse>(
        `/api/orders/${orderId}/bundles/create/`,
        {},
      )
      .then((r) => r.data);
  },

  /**
   * Cut a whole scanned roll into an open bundle.
   *
   * `roll` is the primary key encoded in the label, so the admin never picks a roll
   * from a list: they pick up the roll and scan it. No line is chosen either -- the
   * colour on the roll decides which order line it satisfies, and the whole roll
   * moves, because rolls are not split at the warehouse. A sealed bundle, a spent
   * roll, or a colour this order never asked for is refused.
   */
  scanIntoBundle(
    orderId: number,
    bundleId: number,
    roll: number,
  ): Promise<ScanIntoBundleResponse> {
    return api
      .post<ScanIntoBundleResponse>(
        `/api/orders/${orderId}/bundles/${bundleId}/scan/`,
        { roll },
      )
      .then((r) => r.data);
  },

  /**
   * Take one roll back out of an open bundle.
   *
   * `rollAllocationId` names the RollAllocation row rather than the roll, so the
   * same label appearing twice in one bundle is still removable on its own. The
   * metres go back on the very roll they came off and the line's packed total comes
   * down; the rest of the bundle is untouched.
   */
  removeRollFromBundle(
    orderId: number,
    bundleId: number,
    rollAllocationId: number,
  ): Promise<BundleMutationResponse> {
    return api
      .post<BundleMutationResponse>(
        `/api/orders/${orderId}/bundles/${bundleId}/rolls/${rollAllocationId}/remove/`,
        {},
      )
      .then((r) => r.data);
  },

  /**
   * Seal a bundle, freezing its contents. This is the point of no return: the slip
   * printed from a sealed bundle is a promise about what is in the box, so afterwards
   * no roll can be added and none can be taken out.
   */
  sealBundle(
    orderId: number,
    bundleId: number,
  ): Promise<BundleMutationResponse> {
    return api
      .post<BundleMutationResponse>(
        `/api/orders/${orderId}/bundles/${bundleId}/seal/`,
        {},
      )
      .then((r) => r.data);
  },

  /**
   * Throw an open bundle away, giving back every roll in it in one go. The bundle is
   * kept as CANCELLED rather than deleted, so the order still shows what was tried.
   */
  cancelBundle(
    orderId: number,
    bundleId: number,
  ): Promise<BundleMutationResponse> {
    return api
      .post<BundleMutationResponse>(
        `/api/orders/${orderId}/bundles/${bundleId}/cancel/`,
        {},
      )
      .then((r) => r.data);
  },
};
