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
import type { LeaderboardEntry } from "@/types/dashboard";

interface CustomerBarChartProps {
  customers: LeaderboardEntry[];
}

export default function CustomerBarChart({ customers }: CustomerBarChartProps) {
  if (customers.length === 0) {
    return (
      <div className="bg-white rounded-xl border p-4 shadow-sm mb-4">
        <div className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-3">
          Top Customers
        </div>
        <div className="h-48 flex items-center justify-center text-gray-400 text-xs">
          No data in range
        </div>
      </div>
    );
  }

  const data = [...customers].reverse().map((customer) => ({
    name:
      customer.name.length > 12
        ? customer.name.substring(0, 12) + "..."
        : customer.name,
    orders: customer.count,
  }));

  const totalOrders = customers.reduce((sum, c) => sum + c.count, 0);
  const topThreePct =
    customers.length >= 3
      ? (
          (customers.slice(0, 3).reduce((sum, c) => sum + c.count, 0) /
            totalOrders) *
          100
        ).toFixed(0)
      : null;

  return (
    <div className="bg-white rounded-xl border p-4 shadow-sm mb-4">
      <div className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-3">
        Top Customers
      </div>
      <ResponsiveContainer
        width="100%"
        height={Math.max(120, customers.length * 30)}
      >
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 20 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10 }} />
          <YAxis
            type="category"
            dataKey="name"
            width={90}
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            formatter={(value) => [`${Number(value)} orders`, "Orders"]}
          />
          <Bar
            dataKey="orders"
            fill="#3b82f6"
            radius={[0, 4, 4, 0]}
            barSize={16}
          />
        </BarChart>
      </ResponsiveContainer>
      {topThreePct && (
        <div className="text-sm text-gray-400 mt-2">
          Top 3 customers account for {topThreePct}% of all orders
        </div>
      )}
    </div>
  );
}
