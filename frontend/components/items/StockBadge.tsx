"use client";

import { formatMeters } from "@/types/item";

interface StockBadgeProps {
  total: number;
  /** Metres still orderable. Defaults to `total` when the server omits it. */
  available?: number;
  /** Unit suffix after the figure. Cloth is metres; orders use none. */
  unit?: string;
  showLabel?: boolean;
  lowThreshold?: number;
  size?: "sm" | "md" | "lg";
}

/**
 * A colour's stock in the Inventory list: orderable metres over physical metres.
 *
 * The headline is what is still available, since that is what moves when an
 * order is placed and what an admin scanning the list is actually judging. The
 * warehouse total sits underneath it so the real cloth on the shelf is never
 * lost. A negative figure is styled as an error because it means orders have
 * promised more than exists -- worth spotting on the list rather than only
 * while taking an order.
 */
export default function StockBadge({
  total,
  available,
  unit,
  showLabel = true,
  lowThreshold = 50,
  size = "md",
}: StockBadgeProps) {
  const orderable = available === undefined ? total : available;
  const isOversold = orderable < 0;
  const isZero = orderable <= 0;
  const isLow = orderable > 0 && orderable <= lowThreshold;

  const colorClass = isOversold
    ? "text-red-600"
    : isZero
      ? "text-red-500"
      : isLow
        ? "text-amber-500"
        : "text-green-600";

  const sizeClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-lg",
  };

  const labelSizeClasses = {
    sm: "text-[10px]",
    md: "text-xs",
    lg: "text-sm",
  };

  return (
    <div className="text-right">
      <div className="flex items-center justify-end gap-1">
        <span className={`font-black ${sizeClasses[size]} ${colorClass}`}>
          {formatMeters(orderable)}
          {unit ? ` ${unit}` : ""}
        </span>
        {showLabel && (
          <span className={`text-gray-400 ${labelSizeClasses[size]}`}>available</span>
        )}
      </div>
      {/* The physical total, so the audit trail is always on screen. */}
      <p className={`text-gray-400 ${labelSizeClasses[size]}`}>
        On hand: {formatMeters(total)}
        {unit ? ` ${unit}` : ""}
      </p>
    </div>
  );
}