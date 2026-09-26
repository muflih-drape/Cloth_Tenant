"use client";

import type { TrendPoint } from "@/types/dashboard";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface TrendSparklineProps {
  data: TrendPoint[];
  from: string;
  to: string;
}

export default function TrendSparkline({
  data,
  from,
  to,
}: TrendSparklineProps) {
  if (data.length === 0) {
    return (
      <div className="bg-white rounded-xl border p-4 shadow-sm mb-4">
        <div className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-2">
          Orders Trend
        </div>
        <div className="h-24 flex items-center justify-center text-gray-400 text-xs">
          No data in range
        </div>
      </div>
    );
  }

  const mapDates = () => {
    const dateMap = new Map<string, number>();
    data.forEach((d) => dateMap.set(d.day, d.count));

    const start = new Date(from + "T00:00:00");
    const end = new Date(to + "T00:00:00");
    const filled: { day: string; count: number }[] = [];

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().split("T")[0];
      filled.push({ day: key, count: dateMap.get(key) || 0 });
    }

    return filled;
  };

  const filled = mapDates();

  const CustomXAxisTick = (props: any) => {
    const { x, y, payload } = props;
    const dayValue = payload?.value as string;
    const index = filled.findIndex((d) => d.day === dayValue);
    const total = filled.length;
    const mid = Math.floor(total / 2);

    if (index !== 0 && index !== mid && index !== total - 1) {
      return null;
    }

    return (
      <text x={x} y={y + 10} textAnchor="middle" fontSize="8" fill="#9ca3af">
        {new Date(dayValue + "T00:00:00").toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}
      </text>
    );
  };

  return (
    <div className="bg-white rounded-xl border p-4 shadow-sm mb-4">
      <div className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-2">
        Orders Trend
      </div>
      <ResponsiveContainer width="100%" height={80}>
        <AreaChart data={filled}>
          <XAxis
            dataKey="day"
            tick={CustomXAxisTick}
            axisLine={false}
            tickLine={false}
          />
          <YAxis hide />
          <Tooltip
            formatter={(value) => [Number(value), "Orders"]}
            labelFormatter={(label) => {
              const day = String(label);
              return new Date(day + "T00:00:00").toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              });
            }}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke="#3b82f6"
            strokeWidth={2}
            fill="#3b82f6"
            fillOpacity={0.1}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
