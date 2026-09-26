export type OrderStatus = "DRAFT" | "PENDING" | "EDITING" | "PACKED" | "DISPATCHED";

/**
 * A fabric variant is one colour/finish of a fabric, and it is what carries the
 * cloth: `stockMeters` is physical on-hand stock in the warehouse. Metres are
 * sent as strings by the API (Django decimals) and parsed where numbers are
 * needed, so nothing here silently rounds a 0.5 m cut.
 */
export interface FabricVariant {
  id: number;
  qr_code: string | null;
  image: string | null;
  display_order?: string;
  stock_meters: string;
  stock_updated_at?: string;
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
  /** Opening stock in metres, for a new colour only. */
  stock_meters?: string | number;
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
