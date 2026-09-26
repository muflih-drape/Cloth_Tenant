import { api } from "./axios";
import type { AnalyticsResponse } from "@/types/dashboard";

export const dashboardApi = {
  getAnalytics(from?: string, to?: string): Promise<AnalyticsResponse> {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return api
      .get<AnalyticsResponse>(`/api/dashboard/analytics/?${params.toString()}`)
      .then((r) => r.data);
  },
};
