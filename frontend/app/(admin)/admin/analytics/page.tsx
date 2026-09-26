"use client";

import { useEffect, useState } from "react";
import { dashboardApi } from "@/lib/api/dashboard";
import type { AnalyticsResponse } from "@/types/dashboard";
import RangePresets from "@/components/pages/admin/analytics/RangePresets";
import TrendSparkline from "@/components/pages/admin/analytics/TrendSparkline";
import TimeMetricsRow from "@/components/pages/admin/analytics/TimeMetricsRow";
import StatusDonutChart from "@/components/pages/admin/analytics/StatusDonutChart";
import ValueCards from "@/components/pages/admin/analytics/ValueCards";
import AgentHorizontalBarChart from "@/components/pages/admin/analytics/AgentHorizontalBarChart";
import ItemBarChart from "@/components/pages/admin/analytics/ItemBarChart";
import CustomerBarChart from "@/components/pages/admin/analytics/CustomerBarChart";
import { Spinner } from "@/components/ui/spinner";

export default function AdminAnalyticsPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refetching, setRefetching] = useState(false);

  const fetchData = async (fromDate: string, toDate: string) => {
    setFrom(fromDate);
    setTo(toDate);
    setRefetching(true);
    try {
      const result = await dashboardApi.getAnalytics(fromDate, toDate);
      setData(result);
    } catch (error) {
      console.error("Failed to fetch analytics", error);
    } finally {
      setLoading(false);
      setRefetching(false);
    }
  };

  useEffect(() => {
    const now = new Date();
    const toDate = now.toISOString().split("T")[0];
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - 30);
    fetchData(fromDate.toISOString().split("T")[0], toDate);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }

  return (
    <div className="min-h-screen min-w-full p-1.5">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-black text-gray-800">Analytics</h1>
        {refetching && <Spinner className="size-4" />}
      </div>

      <RangePresets onRangeChange={fetchData} />

      {data && (
        <>
          <StatusDonutChart kpis={data.kpis} />
          <ValueCards kpis={data.kpis} />
          <TrendSparkline data={data.trend} from={from} to={to} />
          <TimeMetricsRow metrics={data.time_metrics} />

          <CustomerBarChart
            customers={data.top_customers.map((c) => ({
              id: c.id,
              name: c.name,
              count: c.count,
            }))}
          />

          <AgentHorizontalBarChart agents={data.top_agents} />

          <ItemBarChart items={data.top_items} />
        </>
      )}
    </div>
  );
}
