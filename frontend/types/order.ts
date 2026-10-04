import type { OrderStatus, RollCutPlan, RollHistoryEntry } from "./item";

export type { OrderStatus, RollCutPlan, RollHistoryEntry };

export interface SimpleAgent {
  id: number;
  username: string;
  contact: string;
}

export interface SimpleCustomer {
  id: number;
  name: string;
  contact: string;
  address: string;
  gst: string;
}

/**
 * One fabric line on an order.
 *
 * `ordered_quantity` is what the customer asked for (demand). `allocated_quantity`
 * is what packing has actually set aside for them, and is the only quantity that
 * has left the roll. The gap between them is a shortfall, not an error.
 */
export interface OrderItem {
  id: number;
  fabric: number | null;
  variant: number | null;
  variant_display_order: string;
  fabric_name: string;
  fabric_name_display: string;
  /** What this line is billed at — the catalogue rate unless it was repriced. */
  rate_per_meter: string;
  /**
   * The catalogue rate the line was added at. `is_rate_overridden` is true when
   * `rate_per_meter` differs from it, i.e. a rate was agreed for this one
   * customer. The fabric's own price is never changed by that.
   */
  original_rate_per_meter: string | null;
  is_rate_overridden: boolean;
  rate_overridden_by: string | null;
  rate_overridden_at: string | null;
  variant_image: string | null;
  ordered_quantity: string;
  allocated_quantity: string;
  outstanding_quantity: string;
  line_total: string;
  allocation_count: number;
  /**
   * Whether this colour's metres live on physical rolls. When true the line is
   * packed by scanning a roll's label rather than by typing a figure, and the
   * server will not cut cloth off a roll nobody named.
   */
  is_roll_tracked: boolean;
  /**
   * Metres of this line's colour still orderable: warehouse total less every
   * order's claim on it, so it already accounts for this line's own outstanding
   * metres. Compared against a retyped quantity to warn about overselling
   * before the edit is saved. `null` for a line with no colour attached.
   */
  variant_available_meters?: string | null;
}

export interface OrderTotals {
  total_ordered_meters: string;
  total_allocated_meters: string;
  total_outstanding_meters: string;
  computed_total: string;
  final_total: string | null;
  effective_total: string;
  is_price_overridden: boolean;
  price_override_reason: string;
  price_overridden_by: string | null;
  price_overridden_at: string | null;
}

export interface Order {
  id: number;
  items: OrderItem[];
  agent: number | null;
  agent_details: SimpleAgent | null;
  /**
   * Write-only on the serializer: accepted when creating an order, but never
   * present in a response. Use `customer_details.id` to read the owning
   * customer back off a fetched order.
   */
  customer?: number;
  customer_details: SimpleCustomer;
  status: OrderStatus;
  totals: OrderTotals;
  is_price_overridden: boolean;
  created_at: string;
  expected_delivery_date: string | null;
  preferred_transport: number | null;
  preferred_transport_name?: string;
  transport_company: number | null;
  transport_company_name?: string;
  lr_number: string;
  dispatched_at: string | null;
  notes?: string;
  /** Set only on PATCH responses when an edit is in flight. */
  edit_snapshot?: Record<string, unknown> | null;
  editing_started_at?: string | null;
}

/** A fabric line that demand has outrun supply on. */
export interface ShortfallLine {
  order_item_id: number;
  fabric_name: string;
  ordered_quantity: string;
  allocated_quantity: string;
  outstanding_quantity: string;
}

/**
 * One oversubscribed line as reported when an order is placed. The figures are
 * for the whole colour, not just this order: `total_demand` adds up every open
 * order, and `available` is what the mill holds.
 */
export interface PlaceOrderShortfall {
  order_item_id: number;
  fabric_name: string;
  variant_display_order: string;
  required: string;
  available: string;
  total_demand: string;
  shortfall: string;
}

export interface PlaceOrderResponse {
  message: string;
  order_id: number;
  shortfall_lines: PlaceOrderShortfall[];
  notice: string | null;
}

export interface DispatchResponse {
  message?: string;
  id?: number;
  status?: OrderStatus;
  error?: string;
  unallocated_lines?: ShortfallLine[];
  hint?: string;
}

export interface OrderRegisterRequest {
  customer: number;
  status?: OrderStatus;
  agent?: number;
}

export type OrderRegisterResponse = Order;

/** Adding a line is done by scanning the roll's QR and asking for metres. */
export interface AddOrderItemRequest {
  qr_code: string;
  ordered_quantity: string;
  /**
   * Bill this line at an agreed rate instead of the catalogue one. Only this
   * order is affected — the fabric keeps its own price for everyone else.
   */
  rate_override?: string;
}

export interface UpdateOrderRequest {
  customer?: number;
  status?: OrderStatus;
  agent?: number;
  expected_delivery_date?: string | null;
  preferred_transport?: number | null;
  notes?: string | null;
}

export interface UpdateOrderItemRequest {
  ordered_quantity?: string;
  variant?: number | null;
  /** Reprice this line only; see `AddOrderItemRequest.rate_override`. */
  rate_override?: string;
}

/** Collapse duplicate lines of the same colour into the one kept. */
export interface MergeOrderItemsRequest {
  keep_item_id: number;
  drop_item_ids: number[];
}

export type OrderAllResponse = Order[];
export type OrderResponse = Order;
export type OrderItems = Order["items"];

/* ------------------------------------------------------------------ */
/* Packing rounds                                                      */
/* ------------------------------------------------------------------ */

export interface AllocationEntry {
  order_item: number;
  order: number;
  customer: string;
  customer_id: number;
  fabric: string;
  variant_display_order: string;
  ordered_quantity: string;
  already_allocated: string;
  outstanding_quantity: string;
  metres: string;
  sequence: number;
  is_priority_award: boolean;
  priority_rank: number | null;
}

export interface PackingPlan {
  variant: number;
  round_size: string;
  available_meters: string;
  participants: number;
  fully_covered: boolean;
  unallocated_meters: string;
  shortfall_meters: string;
  allocations: AllocationEntry[];
  priority: Record<string, unknown>;
  /**
   * Which physical rolls this plan would be cut from, by best fit. Present only
   * for a colour tracked by rolls; a colour without them behaves exactly as it
   * did before.
   */
  roll_cut?: RollCutPlan;
}

export interface PackingQueueLine {
  order_item: number;
  order: number;
  order_status: string;
  customer: string;
  customer_id: number;
  agent: string | null;
  fabric: string;
  variant_display_order: string;
  ordered_quantity: string;
  allocated_quantity: string;
  outstanding_quantity: string;
  priority_rank: number | null;
  metres_sold: string;
  priority_source: string | null;
  order_created_at: string;
}

export interface PackingQueue {
  variant: {
    id: number;
    fabric: string;
    display_order: string;
    stock_meters: string;
    price_per_meter: string;
  };
  outstanding_orders: number;
  total_outstanding_meters: string;
  lines: PackingQueueLine[];
}

export interface PackingRoundSummary {
  id: number;
  variant: number;
  fabric: string;
  display_order: string;
  round_size: string;
  status: "DRAFT" | "CONFIRMED" | "CANCELLED";
  note: string;
  created_by: string | null;
  created_at: string;
  confirmed_at: string | null;
  total_allocated: string;
}

/** The admin's hand-edited plan: which order line gets how many metres. */
export interface PlanOverrideEntry {
  order_item: number;
  metres: string;
}

/* ------------------------------------------------------------------ */
/* Packing a single order line                                         */
/* ------------------------------------------------------------------ */

/**
 * What packing one line from the order page gives back.
 *
 * `item` is the whole line as the server now sees it, and `stock_meters` is what
 * is left on the roll, so the page can update both in place instead of
 * refetching the order. `round` is the packing round the backend built to do it,
 * which is what makes the shortcut auditable rather than a private shortcut.
 *
 * `rolls` names the physical rolls the metres were cut from, for a colour tracked
 * by rolls: empty otherwise, which is every colour that predates roll tracking.
 */
/**
 * One roll of an admin's own breakdown for a single-line pack: which roll, and how
 * much to take off it. Only needed for a colour with physical rolls, where the
 * server refuses to guess which roll to cut; a scan sends the roll's primary key
 * instead. The server re-validates every figure here against the rolls as they are
 * now.
 */
export interface PackLineRollOverride {
  roll: number;
  metres: string;
}

export interface PackLineResponse {
  message: string;
  round: number;
  order: number;
  order_status: OrderStatus;
  item: OrderItem;
  stock_meters: string;
  rolls?: RollHistoryEntry[];
}

/**
 * Lifecycle of a box of cloth. An open bundle is still being worked on: rolls can
 * go in and come back out. Sealed means the contents are final and the packing slip
 * describes exactly what is in the box. Cancelled means every roll was given back.
 */
export type PackingBundleStatus = "OPEN" | "SEALED" | "CANCELLED";

/**
 * One roll sitting in a bundle, with the order line it was cut for and the money
 * on that line. `rate_per_meter` is the rate agreed for this customer, snapshotted
 * onto the line, so a slip printed today matches the invoice for the same cloth.
 */
export interface PackingBundleRoll {
  /** Primary key of the RollAllocation -- what "Remove from bundle" names. */
  id: number;
  roll: number;
  roll_number: string;
  colour: string;
  fabric: string;
  metres: string;
  item: number;
  fabric_name: string;
  variant_display_order: string;
  rate_per_meter: string;
  value: string;
  round: number | null;
  scanned_at: string;
}

/**
 * A bundle and everything the packing slip needs to print, so the sheet can be
 * produced in the browser and reprinted later without asking the server again.
 */
export interface PackingBundle {
  id: number;
  /** 1-based within the order, so an order shows Bundle 1, Bundle 2, ... */
  number: number;
  /** The human-readable code: "Order #48 -- Bundle 1". */
  code: string;
  status: PackingBundleStatus;
  created_at: string;
  sealed_at: string | null;
  created_by: string | null;
  order: number;
  order_number: number;
  customer: string;
  customer_address: string;
  rolls: PackingBundleRoll[];
  roll_count: number;
  total_metres: string;
  total_value: string;
}

export interface CreatePackingBundleResponse {
  message: string;
  bundle: PackingBundle;
}

export interface ScanIntoBundleResponse {
  message: string;
  /** Which order line the roll's colour was matched to. */
  item_id: number;
  fabric_name: string;
  variant_display_order: string;
  order_status: OrderStatus;
  bundle: PackingBundle;
}

export interface BundleMutationResponse {
  message: string;
  order_status?: OrderStatus;
  bundle: PackingBundle;
}

export type PackingBundleListResponse = PackingBundle[];
