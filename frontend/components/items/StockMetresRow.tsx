"use client";

import { formatMeters } from "@/types/item";

interface StockMetresRowProps {
  stockMeters: string;
  isDisabled?: boolean;
  isReadonly?: boolean;
}

/** The on-hand cloth for one colour, in metres. */
export default function StockMetresRow({
  stockMeters,
  isDisabled = false,
  isReadonly = false,
}: StockMetresRowProps) {
  return (
    <div
      className={`flex-shrink-0 px-3 py-2 rounded-lg min-w-[88px] ${
        isDisabled && !isReadonly
          ? "bg-red-100 border border-red-700"
          : "bg-gray-50"
      }`}
    >
      <span
        className={`text-[10px] uppercase tracking-wider font-bold block ${
          isDisabled ? "text-gray-400" : "text-gray-400"
        }`}
      >
        In stock
      </span>
      <span
        className={`text-sm font-black block ${
          isDisabled ? "text-red-400" : "text-gray-900"
        }`}
      >
        {formatMeters(stockMeters)} m
      </span>
    </div>
  );
}
