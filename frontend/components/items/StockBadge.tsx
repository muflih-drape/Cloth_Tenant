"use client";

interface StockBadgeProps {
  total: number;
  sizeGroups?: string[];
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
}

export default function StockBadge({
  total,
  sizeGroups,
  showLabel = true,
  size = "md",
}: StockBadgeProps) {
  const isZero = total === 0;
  const isLow = total > 0 && total <= 10;

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
      <div className="flex items-center justify-end gap-2">
        <span className={`font-black ${sizeClasses[size]} ${colorClass}`}>
          {total}
        </span>
        {showLabel && (
          <span className={`text-gray-400 ${labelSizeClasses[size]}`}>
            Stock
          </span>
        )}
      </div>
      {sizeGroups && sizeGroups.length > 0 && (
        <p className={`text-gray-400 ${labelSizeClasses[size]} mt-0.5`}>
          {sizeGroups.join(" • ")}
        </p>
      )}
    </div>
  );
}
