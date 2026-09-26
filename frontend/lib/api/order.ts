import type {
  OrderAllResponse,
  OrderResponse,
  OrderRegisterRequest,
  OrderRegisterResponse,
  AddOrderItemRequest,
  UpdateOrderRequest,
  UpdateOrderItemRequest,
  InvoiceResponse,
} from "@/types/order";
import { api } from "./axios";
import { PaginatedResponse } from "@/types/global";

export interface OrderLog {
  id: number;
  action: string;
  details: Record<string, any>;
  performed_by: string | null;
  created_at: string;
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

export interface UnpackedOrderItem {
  id: number;
  item_name: string;
  variant_display_order: string;
  quantity: number;
  size_group: string;
  item_type: string;
  variant_image: string;
  piece_count: number;
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
    if (filters?.page_size)
      params.append("page_size", filters.page_size.toString());
    if (filters?.search) params.append("search", filters.search);
    if (filters?.customer) params.append("customer", filters.customer);
    if (filters?.status?.length) {
      filters.status.forEach((s) => {
        params.append("status", s);
      });
    }
    const query = params.toString();
    return api
      .get<
        PaginatedResponse<OrderAllResponse[number]>
      >(`/api/orders/${query ? `?${query}` : ""}`)
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
    if (params?.page_size)
      query.append("page_size", params.page_size.toString());
    return api
      .get<
        PaginatedResponse<OrderAllResponse[number]>
      >(`/api/orders/?${query.toString()}`)
      .then((r) => r.data);
  },

  getOne(id: number): Promise<OrderResponse> {
    return api.get<OrderResponse>(`/api/orders/${id}/`).then((r) => r.data);
  },

  create(data: OrderRegisterRequest): Promise<OrderRegisterResponse> {
    return api
      .post<OrderRegisterResponse>("/api/orders/", data)
      .then((r) => r.data);
  },

  addItem(orderId: number, itemData: AddOrderItemRequest): Promise<void> {
    return api
      .post(`/api/orders/${orderId}/add-item/`, itemData)
      .then((r) => r.data);
  },

  update(id: number, data: UpdateOrderRequest): Promise<OrderResponse> {
    return api
      .patch<OrderResponse>(`/api/orders/${id}/`, data)
      .then((r) => r.data);
  },

  updateItem(itemId: number, data: UpdateOrderItemRequest) {
    return api
      .patch(`/api/orders/order-items/${itemId}/`, data)
      .then((r) => r.data);
  },

  delete(id: number, pin: string): Promise<void> {
    return api
      .delete(`/api/orders/${id}/`, { data: { pin } })
      .then((r) => r.data);
  },

  agentDelete(id: number): Promise<void> {
    return api.delete(`/api/orders/${id}/`).then((r) => r.data);
  },

  deleteItem(orderId: number, itemId: number): Promise<void> {
    return api
      .delete(`/api/orders/${orderId}/delete-item/${itemId}/`)
      .then((r) => r.data);
  },

  invoiceOrder(id: number): Promise<InvoiceResponse> {
    return api
      .get<InvoiceResponse>(`/api/orders/${id}/invoice/`)
      .then((r) => r.data);
  },

  placeOrder(
    id: number,
    data?: {
      expected_delivery_date?: string | null;
      preferred_transport?: number | null;
      notes?: string | null;
    },
  ): Promise<{ message: string; order_id: number }> {
    return api
      .post<{
        message: string;
        order_id: number;
      }>(`/api/orders/${id}/place-order/`, data)
      .then((r) => r.data);
  },

  dispatchOrder(
    id: number,
    data?: { transport_company?: number | null; lr_number?: string },
  ): Promise<{ message: string }> {
    return api
      .post<{ message: string }>(`/api/orders/${id}/dispatch/`, data)
      .then((r) => r.data);
  },

  getOrderLogs(orderId: number): Promise<OrderLog[]> {
    return api
      .get<OrderLog[]>(`/api/orders/${orderId}/logs/`)
      .then((r) => r.data);
  },

  startEdit(id: number): Promise<{ message: string }> {
    return api
      .post<{ message: string }>(`/api/orders/${id}/start-edit/`)
      .then((r) => r.data);
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
      .post<{
        message: string;
        order_id: number;
      }>(`/api/orders/${id}/save-edit/`, data)
      .then((r) => r.data);
  },

  cancelEdit(id: number): Promise<{ message: string }> {
    return api
      .post<{ message: string }>(`/api/orders/${id}/cancel-edit/`)
      .then((r) => r.data);
  },

  getViewedIds(): Promise<number[]> {
    return api.get<number[]>("/api/orders/my-viewed-ids/").then((r) => r.data);
  },

  markAsViewed(orderId: number): Promise<void> {
    return api.post(`/api/orders/${orderId}/mark-viewed/`).then((r) => r.data);
  },

  getUnpackedOrderItems(): Promise<UnpackedOrderItem[]> {
    return api
      .get<UnpackedOrderItem[]>("/api/orders/order-items/unpacked/")
      .then((r) => r.data);
  },

  getArchived(
    filters?: OrderFilters,
  ): Promise<PaginatedResponse<OrderAllResponse[number]>> {
    const params = new URLSearchParams();
    if (filters?.from) params.append("from_date", filters.from);
    if (filters?.to) params.append("to_date", filters.to);
    if (filters?.page) params.append("page", filters.page.toString());
    if (filters?.page_size)
      params.append("page_size", filters.page_size.toString());
    const query = params.toString();
    return api
      .get<
        PaginatedResponse<OrderAllResponse[number]>
      >(`/api/orders/archived/${query ? `?${query}` : ""}`)
      .then((r) => r.data);
  },
};
