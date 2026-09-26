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
import { toMeters } from "@/types/item";

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

  // The API ranks agents by metres allocated, so plot metres rather than
  // order count — otherwise the ordering carries no meaning.
  const data = [...agents].reverse().map((agent) => ({
    name: agent.username,
    metres: toMeters(agent.metres),
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
            formatter={(value, _name, entry) => {
              const orders = (entry?.payload as { orders?: number })?.orders;
              return [
                `${Number(value).toLocaleString("en-IN")} m${
                  orders ? ` · ${orders} orders` : ""
                }`,
                "Metres",
              ];
            }}
          />
          <Bar
            dataKey="metres"
            fill="#3b82f6"
            radius={[0, 4, 4, 0]}
            barSize={16}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
