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
import type { TopItemsEntry } from "@/types/dashboard";

interface ItemBarChartProps {
  items: TopItemsEntry[];
}

export default function ItemBarChart({ items }: ItemBarChartProps) {
  if (items.length === 0) {
    return (
      <div className="bg-white rounded-xl border p-4 shadow-sm mb-4">
        <div className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-3">
          Top Items
        </div>
        <div className="h-48 flex items-center justify-center text-gray-400 text-xs">
          No data in range
        </div>
      </div>
    );
  }

  const data = items.map((item) => ({
    name:
      item.name.length > 12 ? item.name.substring(0, 12) + "..." : item.name,
    quantity: item.qty,
  }));

  return (
    <div className="bg-white rounded-xl border p-4 shadow-sm mb-4">
      <div className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-3">
        Top Items
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
            formatter={(value) => [`${Number(value)} units`, "Quantity"]}
          />
          <Bar
            dataKey="quantity"
            fill="#a855f7"
            radius={[4, 4, 0, 0]}
            barSize={30}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
