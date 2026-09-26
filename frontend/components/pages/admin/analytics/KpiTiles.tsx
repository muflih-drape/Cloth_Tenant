"use client";

import type { AnalyticsKPIs } from "@/types/dashboard";

interface KpiTilesProps {
  kpis: AnalyticsKPIs;
}

export default function KpiTiles({ kpis }: KpiTilesProps) {
  const tiles = [
    { label: "Total", value: kpis.total, color: "text-blue-600" },
    { label: "Pending", value: kpis.pending, color: "text-yellow-600" },
    { label: "Packed", value: kpis.packed, color: "text-purple-600" },
    { label: "Dispatched", value: kpis.dispatched, color: "text-green-600" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
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
