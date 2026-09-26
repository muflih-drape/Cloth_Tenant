"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { TopFabricsEntry } from "@/types/dashboard";
import { toMeters } from "@/types/item";

interface ItemBarChartProps {
  items: TopFabricsEntry[];
}

export default function ItemBarChart({ items }: ItemBarChartProps) {
  if (items.length === 0) {
    return (
      <div className="bg-white rounded-xl border p-4 shadow-sm mb-4">
        <div className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-3">
          Top Fabrics
        </div>
        <div className="h-48 flex items-center justify-center text-gray-400 text-xs">
          No data in range
        </div>
      </div>
    );
  }

  const data = items.map((item) => ({
    name: item.name.length > 12 ? `${item.name.slice(0, 12)}...` : item.name,
    metres: toMeters(item.metres_ordered),
    shipped: toMeters(item.metres_shipped),
  }));

  return (
    <div className="bg-white rounded-xl border p-4 shadow-sm mb-4">
      <div className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-3">
        Top Fabrics
      </div>
      <ResponsiveContainer
        width="100%"
        height={Math.max(150, items.length * 35)}
      >
        <BarChart data={data} margin={{ bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 9 }}
            angle={-30}
            textAnchor="end"
            height={50}
          />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip
            formatter={(value, name) => [
              `${Number(value).toLocaleString("en-IN")} m`,
              name === "metres" ? "Ordered" : "Shipped",
            ]}
          />
          <Bar
            dataKey="metres"
            name="metres"
            fill="#a855f7"
            radius={[4, 4, 0, 0]}
            barSize={30}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
