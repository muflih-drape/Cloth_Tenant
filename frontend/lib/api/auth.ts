import { LoginRequest, LoginResponse, UserProfile } from "@/types/auth";
import { api } from "./axios";

export const authApi = {
  async login(data: LoginRequest): Promise<LoginResponse> {
    const res = await api.post<LoginResponse>("/api/auth/login/", data);

    return res.data;
  },

  async getProfile(): Promise<UserProfile> {
    const res = await api.get<UserProfile>("/api/auth/profile/");
    return res.data;
  },

  forgotPassword: async (data: { email: string }) => {
    const res = await api.post("/api/auth/forgot-password/", data);
    return res.data;
  },

  resetPassword: async (data: { token: string; password: string }) => {
    const res = await api.post("/api/auth/reset-password/", data);
    return res.data;
  },

  logout() {},
};
