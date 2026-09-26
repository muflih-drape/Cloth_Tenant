import type { Item } from "./item";

export type OrderStatus =
  | "DRAFT"
  | "PENDING"
  | "EDITING"
  | "PACKED"
  | "DISPATCHED";

export interface OutOfStockItem {
  item_name: string;
  size_group: string;
  size: string;
  required: number;
  available: number;
  order_item_id: number;
}

export interface PlaceOrderError {
  error: string;
  out_of_stock_items: OutOfStockItem[];
}

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

export interface OrderItem {
  id: number;
  item: Item;
  variant: number | null;
  size_group?: string;
  item_type?: string;
  item_name?: string;
  item_price?: number;
  variant_image?: string | null;
  size?: string;
  quantity: number;
  original_quantity?: number;
  packed_quantity?: number;
  piece_count?: number;
  order: number;
  variant_display_order: string;
}

export interface Order {
  id: number;
  items: OrderItem[];
  agent_details: SimpleAgent;
  customer_details: SimpleCustomer;
  total_quantity?: string;
  total_sets: number;
  total_pieces: number;
  status?: OrderStatus;
  created_at: string;
  agent: number;
  expected_delivery_date: string | null;
  preferred_transport: number | null;
  preferred_transport_name?: string;
  transport_company: number | null;
  transport_company_name?: string;
  lr_number: string;
  notes?: string;
}

export interface OrderItemDisplay {
  quantity: number;
  piece_count: number;
  getTotalPieces: () => number;
}

export interface OrderRegisterRequest {
  customer: number;
  status?: OrderStatus;
  agent?: number;
}

export type OrderRegisterResponse = Order;

export interface AddOrderItemRequest {
  qr_code: string;
  quantity: number;
  size_group: string;
}

export interface UpdateOrderRequest {
  customer?: number;
  status?: OrderStatus;
  agent?: number;
  expected_delivery_date?: string | null;
  preferred_transport?: number | null;
  notes?: string | null;
}

export interface UpdateOrderRequest {
  customer?: number;
  status?: OrderStatus;
  agent?: number;
}

export interface UpdateOrderItemRequest {
  size_group?: string;
  quantity?: number;
  packed_quantity?: number;
  variant?: number | null;
}

export type OrderAllResponse = Order[];

export type OrderResponse = Order;
export type OrderItems = Order["items"];

export interface InvoiceCustomer {
  id: number;
  name: string;
  contact: string;
  address: string;
}

export interface InvoiceAgent {
  id: number;
  username: string;
  contact: string;
}

export interface InvoiceBrand {
  id: number;
  name: string;
  phone: string;
  email: string;
  address_line1: string;
  address_line2: string | null;
  logo_url: string | null;
  gst: string | null;
}

export interface InvoiceResponse {
  id: number;
  customer: InvoiceCustomer;
  agent: InvoiceAgent;
  brand?: InvoiceBrand;
  created_at: string;
  status: OrderStatus;
  items: OrderItem[];
  total_price: number;
  gst_rate: number;
}
