"use client";

import { formatMeters, toMeters } from "@/types/item";

interface StockMetresRowProps {
  stockMeters: string;
  /**
   * Warehouse total less what live orders have already claimed. Falls back to
   * the physical figure when the server does not send it.
   */
  availableMeters?: string | null;
  isDisabled?: boolean;
  isReadonly?: boolean;
}

/**
 * One colour's metres: what is still orderable, over what is physically there.
 *
 * The headline is `available_meters` because that is the figure that answers
 * "can this colour take another order", and it moves as soon as one is placed.
 * The physical total stays underneath as the audit trail, so an admin can still
 * see the real cloth on the shelf without opening anything.
 */
export default function StockMetresRow({
  stockMeters,
  availableMeters,
  isDisabled = false,
  isReadonly = false,
}: StockMetresRowProps) {
  const available =
    availableMeters === undefined || availableMeters === null
      ? toMeters(stockMeters)
      : toMeters(availableMeters);
  const isOversold = available < 0;

  return (
    <div
      className={`flex-shrink-0 px-3 py-2 rounded-lg min-w-[88px] ${
        isDisabled && !isReadonly
          ? "bg-red-100 border border-red-700"
          : "bg-gray-50"
      }`}
    >
      <span className="text-[10px] uppercase tracking-wider font-bold block text-gray-400">
        Available
      </span>
      <span
        className={`text-sm font-black block ${
          isOversold
            ? "text-red-600"
            : isDisabled
              ? "text-red-400"
              : "text-gray-900"
        }`}
      >
        {formatMeters(available)} m
      </span>
      {/* The cloth itself, kept visible so the derived figure above is never the
          only thing on screen. */}
      <span className="text-[10px] text-gray-400 block">
        On hand: {formatMeters(toMeters(stockMeters))} m
      </span>
    </div>
  );
}