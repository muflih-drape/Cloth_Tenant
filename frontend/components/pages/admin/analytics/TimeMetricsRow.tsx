"use client";

import type { TimeMetrics } from "@/types/dashboard";

interface TimeMetricsRowProps {
  metrics: TimeMetrics;
}

function formatHours(hours: number | null): string {
  if (hours === null) return "—";
  return hours.toFixed(1);
}

function formatPct(pct: number | null): string {
  if (pct === null) return "—";
  return pct.toFixed(0) + "%";
}

export default function TimeMetricsRow({ metrics }: TimeMetricsRowProps) {
  const cards = [
    {
      label: "Avg Dispatch",
      value: formatHours(metrics.avg_dispatch_hours),
      unit: metrics.avg_dispatch_hours !== null ? "hrs" : "",
    },
    {
      label: "Median Dispatch",
      value: formatHours(metrics.median_dispatch_hours),
      unit: metrics.median_dispatch_hours !== null ? "hrs" : "",
    },
    {
      label: "Within 24h",
      value: formatPct(metrics.dispatched_within_24h_pct),
      unit: "",
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-3 mb-4">
      {cards.map(({ label, value, unit }) => (
        <div
          key={label}
          className="bg-white rounded-xl border p-3 text-center shadow-sm"
        >
          <div className="text-lg font-black text-blue-600">
            {value}
            {unit && <span className="text-xs ml-0.5">{unit}</span>}
          </div>
          <div className="text-sm font-bold uppercase tracking-wider text-gray-400 mt-0.5">
            {label}
          </div>
        </div>
      ))}
    </div>
  );
}
