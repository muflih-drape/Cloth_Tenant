export interface AnalyticsKPIs {
  total: number;
  draft: number;
  pending: number;
  editing: number;
  packed: number;
  dispatched: number;
  total_value?: number;
  total_sets?: number;
  total_pieces?: number;
}

export interface TrendPoint {
  day: string;
  count: number;
}

export interface LeaderboardEntry {
  id: number;
  name: string;
  count: number;
}

export interface TopAgentsEntry {
  id: number;
  username: string;
  count: number;
}

export interface TopItemsEntry {
  name: string;
  qty: number;
}

export interface TimeMetrics {
  avg_dispatch_hours: number | null;
  median_dispatch_hours: number | null;
  dispatched_within_24h_pct: number | null;
}

export interface AnalyticsResponse {
  kpis: AnalyticsKPIs;
  trend: TrendPoint[];
  top_customers: LeaderboardEntry[];
  top_agents: TopAgentsEntry[];
  top_items: TopItemsEntry[];
  time_metrics: TimeMetrics;
}
