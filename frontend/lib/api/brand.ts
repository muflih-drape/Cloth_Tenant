import type {
  BrandAllResponse,
  BrandResponse,
  BrandFormData,
  BrandDeleteInfo,
} from "@/types/brand";
import { api } from "./axios";

export const brandApi = {
  getAll(): Promise<BrandAllResponse> {
    return api.get<BrandAllResponse>("/api/business/").then((r) => r.data);
  },

  getOne(id: number): Promise<BrandResponse> {
    return api.get<BrandResponse>(`/api/business/${id}/`).then((r) => r.data);
  },

  create(data: BrandFormData): Promise<BrandResponse> {
    const fd = new FormData();
    fd.append("name", data.name);
    fd.append("phone", data.phone);
    fd.append("email", data.email);
    fd.append("address_line1", data.address_line1);
    if (data.address_line2) fd.append("address_line2", data.address_line2);
    if (data.gst) fd.append("gst", data.gst);
    if (data.logo) fd.append("logo", data.logo);
    return api.post<BrandResponse>("/api/business/", fd).then((r) => r.data);
  },

  update(id: number, data: Partial<BrandFormData>): Promise<BrandResponse> {
    const fd = new FormData();
    if (data.name !== undefined) fd.append("name", data.name);
    if (data.phone !== undefined) fd.append("phone", data.phone);
    if (data.email !== undefined) fd.append("email", data.email);
    if (data.address_line1 !== undefined) fd.append("address_line1", data.address_line1);
    if (data.address_line2 !== undefined) fd.append("address_line2", data.address_line2);
    if (data.gst !== undefined) fd.append("gst", data.gst);
    if (data.logo !== undefined && data.logo !== null) fd.append("logo", data.logo);
    return api.patch<BrandResponse>(`/api/business/${id}/`, fd).then((r) => r.data);
  },

  getDeleteInfo(id: number): Promise<BrandDeleteInfo> {
    return api.get<BrandDeleteInfo>(`/api/business/${id}/delete_info/`).then((r) => r.data);
  },

  delete(id: number, pin?: string, action?: string, transfer_to_id?: number): Promise<void> {
    return api
      .delete(`/api/business/${id}/`, { data: { pin, action, transfer_to_id } })
      .then((r) => r.data);
  },
};
