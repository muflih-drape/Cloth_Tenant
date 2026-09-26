export interface Brand {
  id: number;
  name: string;
  phone: string;
  email: string;
  address_line1: string;
  address_line2: string | null;
  logo: string | null;
  logo_url: string | null;
  gst: string | null;
  created_at: string;
  updated_at: string;
}

export interface BrandFormData {
  name: string;
  phone: string;
  email: string;
  address_line1: string;
  address_line2: string;
  logo: File | null;
  gst: string;
}

export type BrandAllResponse = Brand[];
export type BrandResponse = Brand;

export interface BrandDeleteInfo {
  items_count: number;
  users_count: number;
  transferable_brands: { id: number; name: string }[];
}
