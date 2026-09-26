export interface AnalyticsKPIs {
  total: number;
  draft: number;
  pending: number;
  editing: number;
  packed: number;
  dispatched: number;
  /** Metres ordered across placed (non-DRAFT) orders in the range. */
  total_metres_ordered: string;
  /** Metres allocated on dispatched orders. */
  total_metres_shipped: string;
  /** Billed revenue, so an admin's price override is reflected. */
  total_value: number;
}

export interface TrendPoint {
  day: string;
  count: number;
}

export interface LeaderboardEntry {
  id: number;
  name: string;
  count: number;
  /** Metres allocated across this customer's orders. */
  metres: string;
}

export interface TopAgentsEntry {
  id: number;
  username: string;
  count: number;
  /** Metres allocated across this agent's orders. */
  metres: string;
}

export interface TopFabricsEntry {
  name: string;
  metres_ordered: string;
  metres_shipped: string;
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
  top_fabrics: TopFabricsEntry[];
  time_metrics: TimeMetrics;
}
