"use client";

import { formatMeters } from "@/types/item";

interface StockBadgeProps {
  total: number;
  /** Unit suffix after the figure. Cloth is metres; orders use none. */
  unit?: string;
  showLabel?: boolean;
  lowThreshold?: number;
  size?: "sm" | "md" | "lg";
}

export default function StockBadge({
  total,
  unit,
  showLabel = true,
  lowThreshold = 50,
  size = "md",
}: StockBadgeProps) {
  const isZero = total <= 0;
  const isLow = total > 0 && total <= lowThreshold;

  const colorClass = isZero
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
          {formatMeters(total)}
          {unit ? ` ${unit}` : ""}
        </span>
        {showLabel && (
          <span className={`text-gray-400 ${labelSizeClasses[size]}`}>in stock</span>
        )}
      </div>
    </div>
  );
}
