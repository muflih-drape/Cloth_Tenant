export type Role = "ADMIN" | "AGENT";
export type Business = "gents" | "kids";

export interface LoginRequest {
  username?: string;
  email?: string;
  password: string;
}

export interface LoginResponse {
  access: string;
  refresh: string;
  role: Role;
  user_id: number;
  username?: string;
  email?: string;
  business?: Business | null;
  is_superuser: boolean;
}

export interface AuthUser {
  id: number;
  role: Role;
  username?: string;
  email?: string;
  business?: Business | null;
  is_superuser: boolean;
}

export interface UserProfile {
  id: number;
  username: string;
  display_name?: string;
  email: string;
  role: Role;
  business?: Business | null;
  is_superuser: boolean;
}
