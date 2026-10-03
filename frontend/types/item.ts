export type OrderStatus = "DRAFT" | "PENDING" | "EDITING" | "PACKED" | "DISPATCHED";

/**
 * A fabric variant is one colour/finish of a fabric, and it is what carries the
 * cloth: `stockMeters` is physical on-hand stock in the warehouse. Metres are
 * sent as strings by the API (Django decimals) and parsed where numbers are
 * needed, so nothing here silently rounds a 0.5 m cut.
 *
 * `is_roll_tracked` says whether the colour's metres are broken down into
 * physical rolls. When it is true the stock figure is the roll total and must be
 * changed by receiving, cutting or adjusting a roll -- never by typing it in.
 */
export interface FabricVariant {
  id: number;
  qr_code: string | null;
  image: string | null;
  display_order?: string;
  stock_meters: string;
  stock_updated_at?: string;
  is_roll_tracked?: boolean;
  roll_count?: number;
  roll_stock_meters?: string;
}

/** One physical roll of cloth on the shelf (or in a customer's hands). */
export interface FabricRoll {
  id: number;
  variant: number;
  roll_number: string;
  note: string;
  original_meters: string;
  remaining_meters: string;
  consumed_meters: string;
  is_active: boolean;
  is_exhausted: boolean;
  fabric_name?: string;
  display_order?: string;
  created_at: string;
  updated_at: string;
}

/** Roll counts and totals for one colour, from the roll endpoints. */
export interface RollSummary {
  is_roll_tracked: boolean;
  roll_count: number;
  active_roll_count: number;
  exhausted_roll_count: number;
  total_received_meters: string;
  roll_stock_meters: string;
  consumed_meters: string;
  largest_roll_meters: string;
  smallest_roll_meters: string;
}

export interface VariantRollsResponse extends RollSummary {
  variant: number;
  fabric: string;
  display_order: string;
  /** The fabric's price, so a roll's label can be valued without another read. */
  price_per_meter: string;
  stock_meters: string;
  rolls: FabricRoll[];
}

export interface ReceiveRollResponse extends RollSummary {
  roll: FabricRoll;
  stock_meters: string;
}

export interface BulkReceiveRollsResponse extends RollSummary {
  created: number;
  total_meters: string;
  stock_meters: string;
  rolls: FabricRoll[];
}

/** One line of a roll's history: metres cut off it, and where they went. */
export interface RollHistoryEntry {
  id: number;
  roll_number: string;
  metres: string;
  is_reversed: boolean;
  created_at: string;
  round: number | null;
  round_status: string | null;
  order: number | null;
  order_status: string | null;
  customer: string | null;
  order_item: number;
}

export interface RollHistoryResponse {
  roll: FabricRoll;
  entries: RollHistoryEntry[];
}

/** Which rolls a packing of N metres would be cut from, oldest first. */
export interface RollCutPlan {
  rolls: {
    roll: number;
    roll_number: string;
    metres: string;
    remaining_before: string;
    remaining_after: string;
  }[];
  requested_meters: string;
  covered_meters: string;
  shortfall_meters: string;
  available_meters: string;
}

export interface Fabric {
  id: number;
  name: string;
  description?: string;
  price_per_meter: string;
  variants: FabricVariant[];
  total_stock_meters: string;
  out_of_stock_since?: string | null;
  /** Set once a fabric has been out of stock long enough to auto-archive. */
  purge_on?: string | null;
  days_until_purge?: number | null;
}

/** What the admin catalogue form builds and sends. */
export interface FabricVariantRequest {
  id?: number;
  image?: File | string | null;
  remove_image?: boolean;
  /** Null clears an existing colour's label. */
  display_order?: string | null;
  /** Warehouse stock in metres; sent for new and existing colours. */
  stock_meters?: string | number;
  /**
   * Set for a colour whose metres live on physical rolls. `stock_meters` is then
   * left out of the payload entirely: that colour's total is the roll total, and
   * only receiving, cutting or adjusting a roll may move it.
   */
  is_roll_tracked?: boolean;
}

export interface FabricRequest {
  name: string;
  description?: string;
  price_per_meter: string;
  variants: FabricVariantRequest[];
}

export type FabricResponse = Fabric;

export type FabricAllResponse = Fabric[];

/** The by-QR scan response: the whole fabric plus which variant was scanned. */
export type FabricQRResponse = Fabric & {
  matched_variant_id?: number;
};

/** One row per colour/finish, for the order wizard's variant picker. */
export interface VariantAllItem {
  id: number;
  fabric_id: number;
  fabric_name: string;
  price_per_meter: string;
  qr_code: string | null;
  image: string | null;
  display_order?: string;
  stock_meters: string;
  stock_updated_at: string;
  is_roll_tracked?: boolean;
  roll_count?: number;
  roll_stock_meters?: string;
}

export type VariantAllResponse = VariantAllItem[];

/** Per-fabric rollup used by the order wizard's stock list. */
export interface FabricStockEntry {
  id: number;
  name: string;
  price_per_meter: string;
  image: string | null;
  variants: FabricVariant[];
}

export interface OutstandingDemandRow {
  variant: number;
  fabric: string;
  fabric_id: number;
  display_order: string;
  stock_meters: string;
  outstanding_meters: string;
  is_backordered: boolean;
}

export interface CustomerRequirementCustomer {
  order_id: number;
  order_status: string;
  customer_name: string;
  agent: string | null;
  fabric_name: string;
  variant_display_order: string;
  ordered_quantity: string;
  allocated_quantity: string;
  outstanding_quantity: string;
  variant_image: string | null;
}

export interface CustomerRequirementResponse {
  fabric: {
    id: number;
    name: string;
    price_per_meter: string;
  };
  customers: CustomerRequirementCustomer[];
}

/** What the admin catalogue form holds in local state. */
export interface ColorVariant {
  id: string;
  stockMeters: string;
  displayOrder: string;
  image: File | null;
  imagePreview: string | null;
}

/** The fabric-wide fields the wizard collects in step 1. */
export interface FabricDetails {
  name: string;
  description: string;
  price_per_meter: string;
}

export interface EditableVariant {
  backendId: number;
  localId: string;
  stockMeters: string;
  displayOrder: string;
  imageUrl: string | null;
  newImage: File | null;
  imagePreview: string | null;
  /**
   * True once the colour has physical rolls. Its metre count is then owned by
   * those rolls: shown read-only here, and left out of the save payload.
   */
  isRollTracked?: boolean;
  rollCount?: number;
}

export type WizardStep =
  | { screen: "common" }
  | { screen: "list" }
  | { screen: "add-color"; editingId?: string };

export interface UIVariant {
  id: number;
  image: string | null;
  qr_code: string | null;
  display_order?: string;
  stock_meters: string;
}

export interface UIItem {
  id: number;
  name: string;
  price_per_meter: string;
  variants: UIVariant[];
  days_until_purge?: number | null;
}

/**
 * Parse a metre string from the API into a number. `Number("")` is 0 and
 * `Number("12.5abc")` is NaN, both of which are worse than a hard 0 here, so
 * invalid input collapses to 0 and callers decide whether that is allowed.
 */
export function toMeters(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Format metres for display: trims trailing zeros, never shows false precision. */
export function formatMeters(value: string | number | null | undefined): string {
  const metres = toMeters(value);
  return Number.isInteger(metres) ? String(metres) : metres.toFixed(3).replace(/0+$/, "");
}

/**
 * Quantise to the 3-decimal precision the backend stores metres at. Summing
 * 0.1 + 0.2 in floating point drifts past the roll's stock and would raise a
 * false "you have over-allocated" warning, so every client-side total and
 * comparison goes through this first.
 */
export function roundMetres(value: string | number | null | undefined): number {
  return Math.round((toMeters(value) + Number.EPSILON) * 1000) / 1000;
}
