export interface Transport {
  id: number;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface TransportCreateRequest {
  name: string;
  is_active?: boolean;
}

export interface TransportUpdateRequest {
  name?: string;
  is_active?: boolean;
}

export type TransportAllResponse = Transport[];
