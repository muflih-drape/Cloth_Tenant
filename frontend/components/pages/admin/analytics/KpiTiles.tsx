"use client";

import type { AnalyticsKPIs } from "@/types/dashboard";

interface KpiTilesProps {
  kpis: AnalyticsKPIs;
}

export default function KpiTiles({ kpis }: KpiTilesProps) {
  // Partly dispatched gets its own tile rather than being folded into Dispatched:
  // an order with boxes still in the warehouse is not finished, and reporting it
  // as dispatched is how a part-delivered order gets forgotten about.
  const tiles = [
    { label: "Total", value: kpis.total, color: "text-blue-600" },
    { label: "Pending", value: kpis.pending, color: "text-yellow-600" },
    { label: "Packed", value: kpis.packed, color: "text-purple-600" },
    {
      label: "Partly dispatched",
      value: kpis.partially_dispatched ?? 0,
      color: "text-teal-600",
    },
    { label: "Dispatched", value: kpis.dispatched, color: "text-green-600" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
      {tiles.map(({ label, value, color }) => (
        <div
          key={label}
          className="bg-white rounded-xl border p-4 text-center shadow-sm"
        >
          <div className={`text-2xl font-black ${color}`}>{value}</div>
          <div className="text-sm font-bold uppercase tracking-wider text-gray-400 mt-1">
            {label}
          </div>
        </div>
      ))}
    </div>
  );
}
