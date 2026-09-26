export type ItemType = "kids" | "gents";

export type ItemStatus = "PENDING" | "PACKED" | "DISPATCHED";

export interface ItemVariantSize {
  id: number;
  size_range?: string;
  size?: string;
  stock: number;
}

export interface ItemVariant {
  id: number;
  qr_code: string;
  image: string | null;
  sizes: ItemVariantSize[];
  display_order?: string;
}

export interface Item {
  id: number;
  name: string;
  type?: ItemType;
  price: string;
  description?: string;
  variants: ItemVariant[];
}

export interface ItemVariantRequest {
  id?: number;

  image?: File | string | null;

  sizes: {
    size: string;
    stock?: number;
  }[];
}

export interface ItemRequest {
  name: string;
  description?: string;
  price: string;
  type?: ItemType;
  variants: ItemVariantRequest[];
}

export type ItemAllResponse = Item[];

export type ItemResponse = Item;

export type ItemQRResponse = Item & {
  matched_variant_id?: number;
};

export interface VariantSize {
  size_range: string;
  stock: number;
}

export interface VariantAllItem {
  id: number;
  item_id: number;
  item_name: string;
  item_type: ItemType;
  item_price: string;
  qr_code: string | null;
  image: string | null;
  sizes: VariantSize[];
  total_stock: number;
  unique_sizes: string[];
}

export type VariantAllResponse = VariantAllItem[];

export interface ItemVariantQR {
  id: number;
  qr_code: string | null;
  image: string | null;
  sizes: VariantSize[];
  total_stock: number;
  display_order?: string;
}

export interface ItemStockEntry {
  id: number;
  name: string;
  type: ItemType;
  price: string;
  image: string | null;
  variants: ItemVariantQR[];
}

export interface CommonDetails {
  name: string;
  description: string;
  price: string;
  type: ItemType;
  brand_id: number | undefined;
}

export interface EditCommonDetails {
  name: string;
  description: string;
  price: string;
  type: ItemType;
}

export type FrontendSizeRange =
  | "20-36"
  | "26-38"
  | "20-38"
  | "20-24"
  | "26-36"
  | "20-30"
  | "32-38"
  | "32-36"
  | "38"
  | "S,M,L,XL"
  | "M,L,XL,XXL"
  | "S,M,L,XL,XXL"
  | "M,L,XL";

export interface ColorVariant {
  id: string;
  sizeRange: FrontendSizeRange;
  stock: number;
  display_order?: string;

  perSizeStock: Partial<Record<FrontendSizeRange, number>>;

  image: File | null;
  imagePreview: string | null;
}

export interface EditableVariant {
  backendId: number;
  localId: string;
  size: string;
  stock: number;
  imageUrl: string | null;
  newImage: File | null;
  imagePreview: string | null;
  display_order?: string;
}

export interface CustomerRequirementItem {
  id: number;
  name: string;
}

export interface CustomerRequirementCustomer {
  customer_name: string;
  variant_display_order: string;
  quantity: number;
  size_group: string;
  variant_image: string;
}

export interface CustomerRequirementResponse {
  item: CustomerRequirementItem;
  customers: CustomerRequirementCustomer[];
}

export type SizeContext = "item_creation" | "order_creation";

export let ITEM_CREATION_SIZES_BY_TYPE: Record<ItemType, FrontendSizeRange[]> =
  {
    gents: [],
    kids: [],
  };

export let ORDER_CREATION_SIZES_BY_TYPE: Record<ItemType, FrontendSizeRange[]> =
  {
    gents: [],
    kids: [],
  };

export function setSizeRanges(data: {
  item_creation_sizes_by_type: Record<ItemType, FrontendSizeRange[]>;

  order_creation_sizes_by_type: Record<ItemType, FrontendSizeRange[]>;
}) {
  ITEM_CREATION_SIZES_BY_TYPE = data.item_creation_sizes_by_type;

  ORDER_CREATION_SIZES_BY_TYPE = data.order_creation_sizes_by_type;
}

export function getSizesForItemType(
  itemType: ItemType,
  context: SizeContext,
): FrontendSizeRange[] {
  if (context === "item_creation") {
    return ITEM_CREATION_SIZES_BY_TYPE[itemType];
  }

  return ORDER_CREATION_SIZES_BY_TYPE[itemType];
}

export const SIZE_RANGE_TO_SIZES: Record<FrontendSizeRange, string[]> = {
  "20-38": ["20-24", "26-30", "32-36", "38"],

  "20-36": ["20-24", "26-30", "32-36"],

  "26-38": ["26-30", "32-36", "38"],

  "26-36": ["26-30", "32-36"],

  "20-30": ["20-24", "26-30"],

  "32-38": ["32-36", "38"],

  "20-24": ["20-24"],

  "32-36": ["32-36"],

  "38": ["38"],

  "S,M,L,XL": ["S", "M,L,XL"],

  "M,L,XL,XXL": ["M,L,XL", "XXL"],

  "S,M,L,XL,XXL": ["S", "M,L,XL", "XXL"],

  "M,L,XL": ["M,L,XL"],
};

export const SIZE_RANGE_PIECE_COUNT: Record<string, number> = {
  "20-38": 10,
  "20-36": 9,
  "26-38": 7,
  "20-30": 6,
  "26-36": 6,
  "32-38": 4,
  "32-36": 3,
  "S,M,L,XL,XXL": 5,
  "S,M,L,XL": 4,
  "M,L,XL,XXL": 4,
  "M,L,XL": 3,
};

export type SizeEnum = "S" | "M" | "L" | "XL" | "XXL";

export type WizardStep =
  | { screen: "common" }
  | { screen: "list" }
  | {
      screen: "add-color";
      editingId?: string;
    };

export interface UIVariant {
  id: number;
  image: string | null;
  qr_code: string | null;
  display_order?: string;

  sizes: {
    size_range: string;
    stock: number;
  }[];
}

export interface UIItem {
  id: number;
  name: string;
  type: ItemType;
  price: string;
  variants: UIVariant[];
  purge_on?: string | null;
  days_until_purge?: number | null;
}
