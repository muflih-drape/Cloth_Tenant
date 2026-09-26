"use client";

import type { AnalyticsKPIs } from "@/types/dashboard";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

interface StatusDonutChartProps {
  kpis: AnalyticsKPIs;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "#9ca3af",
  pending: "#eab308",
  editing: "#f97316",
  packed: "#a855f7",
  dispatched: "#22c55e",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending: "Pending",
  editing: "Editing",
  packed: "Packed",
  dispatched: "Dispatched",
};

export default function StatusDonutChart({ kpis }: StatusDonutChartProps) {
  const data = [
    { name: "draft", value: kpis.draft },
    { name: "pending", value: kpis.pending },
    { name: "editing", value: kpis.editing },
    { name: "packed", value: kpis.packed },
    { name: "dispatched", value: kpis.dispatched },
  ].filter((d) => d.value > 0);

  const total = data.reduce((sum, d) => sum + d.value, 0);

  if (total === 0) {
    return (
      <div className="bg-white rounded-xl border p-4 shadow-sm mb-4">
        <div className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-3">
          Order Status
        </div>
        <div className="h-48 flex items-center justify-center text-gray-400 text-xs">
          No data in range
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border p-4 shadow-sm mb-4">
      <div className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-3">
        Order Status
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={3}
            dataKey="value"
          >
            {data.map((entry) => (
              <Cell
                key={entry.name}
                fill={STATUS_COLORS[entry.name] || "#3b82f6"}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name) => [
              `${Number(value)} (${((Number(value) / total) * 100).toFixed(1)}%)`,
              STATUS_LABELS[String(name)] || String(name),
            ]}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-2 mt-2 justify-center">
        {data.map((entry) => (
          <div key={entry.name} className="flex items-center gap-1">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: STATUS_COLORS[entry.name] }}
            />
            <span className="text-sm text-gray-500">
              {STATUS_LABELS[entry.name]}: {entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
