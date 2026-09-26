import type {
  CustomerAllResponse,
  CustomerResponse,
  CustomerCreateRequest,
  CustomerUpdateRequest,
  CustomerDeleteInfo,
  BulkImportResponse,
  BulkImportRequest,
} from "@/types/customer";
import { api } from "./axios";
import type { PaginatedResponse } from "@/types/global";

export interface CustomerFilters {
  page?: number;
  page_size?: number;
  search?: string;
}

export const customerApi = {
  getAll(
    filters?: CustomerFilters,
  ): Promise<PaginatedResponse<CustomerAllResponse[number]>> {
    const params = new URLSearchParams();
    if (filters?.page) params.append("page", filters.page.toString());
    if (filters?.page_size)
      params.append("page_size", filters.page_size.toString());
    if (filters?.search) params.append("search", filters.search);
    const query = params.toString();
    return api
      .get<
        PaginatedResponse<CustomerAllResponse[number]>
      >(`/api/customers/${query ? `?${query}` : ""}`)
      .then((r) => r.data);
  },

  getOne(id: number): Promise<CustomerResponse> {
    return api
      .get<CustomerResponse>(`/api/customers/${id}/`)
      .then((r) => r.data);
  },

  create(data: CustomerCreateRequest): Promise<CustomerResponse> {
    return api
      .post<CustomerResponse>("/api/customers/", data)
      .then((r) => r.data);
  },

  update(id: number, data: CustomerUpdateRequest): Promise<CustomerResponse> {
    return api
      .patch<CustomerResponse>(`/api/customers/${id}/`, data)
      .then((r) => r.data);
  },

  getDeleteInfo(id: number): Promise<CustomerDeleteInfo> {
    return api.get<CustomerDeleteInfo>(`/api/customers/${id}/delete_info/`).then((r) => r.data);
  },

  delete(id: number, pin: string, action?: string): Promise<void> {
    return api
      .delete(`/api/customers/${id}/`, { data: { pin, action } })
      .then((r) => r.data);
  },

  agentDelete(id: number): Promise<void> {
    return api.delete(`/api/customers/${id}/`).then((r) => r.data);
  },

  bulkImport(data: BulkImportRequest): Promise<BulkImportResponse> {
    return api
      .post<BulkImportResponse>("/api/customers/bulk-import/", data)
      .then((r) => r.data);
  },
};
