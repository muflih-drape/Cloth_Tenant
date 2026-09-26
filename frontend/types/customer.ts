export interface Customer {
  id: number;
  total_orders: string;
  agent_name: string;
  name: string;
  address: string;
  contact: string;
  agent: number;
  gst: string;
  preferred_transport: number | null;
  preferred_transport_name?: string;
  has_business_orders?: boolean | null;
}

export interface CustomerCreateRequest {
  name: string;
  address: string;
  contact: string;
  agent: number;
  gst: string;
  preferred_transport?: number | null;
}

export interface CustomerUpdateRequest {
  name?: string;
  address?: string;
  contact?: string;
  agent?: number;
  gst: string;
  preferred_transport?: number | null;
}

export type CustomerAllResponse = Customer[];
export type CustomerResponse = Customer;

export interface BulkCustomerRequest {
  name: string;
  address?: string;
  contact: string;
  agent: string;
  gst: string;
  transport: string;
}

export interface BulkCustomerResponse {
  id: number;
  name: string;
  address: string;
  contact: string;
  agent: string;
  gst: string;
  transport: string;
}

export interface BulkCustomerAllResponse {
  count: number;
  results: CustomerResponse[];
}

export interface BulkImportRequest {
  customers: Omit<BulkCustomerRequest, never>[];
}

export interface BulkImportResponse {
  created: number;
  failed: number;
  errors?: { row: number; error: string }[];
}

export interface CustomerDeleteInfo {
  orders_count: number;
}
