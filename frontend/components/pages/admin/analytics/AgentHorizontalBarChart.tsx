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
import type { TopAgentsEntry } from "@/types/dashboard";

interface AgentHorizontalBarChartProps {
  agents: TopAgentsEntry[];
}

export default function AgentHorizontalBarChart({
  agents,
}: AgentHorizontalBarChartProps) {
  if (agents.length === 0) {
    return (
      <div className="bg-white rounded-xl border p-4 shadow-sm mb-4">
        <div className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-3">
          Top Agents
        </div>
        <div className="h-48 flex items-center justify-center text-gray-400 text-xs">
          No data in range
        </div>
      </div>
    );
  }

  const data = [...agents].reverse().map((agent) => ({
    name: agent.username,
    orders: agent.count,
  }));

  return (
    <div className="bg-white rounded-xl border p-4 shadow-sm mb-4">
      <div className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-3">
        Top Agents
      </div>
      <ResponsiveContainer
        width="100%"
        height={Math.max(120, agents.length * 30)}
      >
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 20 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10 }} />
          <YAxis
            type="category"
            dataKey="name"
            width={80}
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
    </div>
  );
}
