"use client";

import type { AnalyticsKPIs } from "@/types/dashboard";

interface ValueCardsProps {
  kpis: AnalyticsKPIs;
}

function formatInr(value: number): string {
  return "₹" + value.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export default function ValueCards({ kpis }: ValueCardsProps) {
  const { total_value, total_sets, total_pieces } = kpis;
  const piecesText =
    typeof total_pieces === "number"
      ? `${total_pieces.toLocaleString("en-IN")} ${total_pieces === 1 ? "pc" : "pcs"}`
      : null;

  return (
    <div className="grid grid-cols-2 gap-3 mb-4">
      {typeof total_value === "number" && (
        <div className="bg-white rounded-xl border p-3 shadow-sm">
          <div className="text-lg font-black text-black">
            {formatInr(total_value)}
          </div>
          <div className="text-sm font-bold uppercase tracking-wider text-gray-400 mt-0.5">
            Total Order Value
          </div>
        </div>
      )}
      {typeof total_sets === "number" && (
        <div className="bg-white rounded-xl border p-3 shadow-sm">
          <div className="text-lg font-black text-black">
            {total_sets.toLocaleString("en-IN")}
          </div>
          <div className="text-sm font-bold uppercase tracking-wider text-gray-400 mt-0.5">
            Total Sets Ordered
          </div>
          {piecesText && (
            <div className="text-xs text-gray-400 mt-0.5">{piecesText}</div>
          )}
        </div>
      )}
    </div>
  );
}