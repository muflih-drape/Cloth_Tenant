"use client";

interface OrderListHeaderProps {
  title: string;
  count: number;
  countColor?: "amber" | "green";
  showFilters?: boolean;
  handleToggleFilters?: () => void;
  pageIndicator?: React.ReactNode;
}

export default function OrderListHeader({
  title,
  count,
  countColor = "amber",
  pageIndicator,
}: OrderListHeaderProps) {
  const badgeColorClasses = {
    amber: "bg-amber-100 text-amber-600 border-amber-200",
    green: "bg-green-100 text-green-600 border-green-200",
  };

  return (
    <div className="pt-4 flex flex-row justify-between items-center gap-2 mb-6">
      <div className="flex flex-1 flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-1">
          <span className="text-gray-400 text-[10px] font-bold uppercase tracking-wider">
            {title}
          </span>
          <div
            className={`rounded-full py-0.5 px-3 border ${badgeColorClasses[countColor]}`}
          >
            <span className="font-bold text-xs">{count}</span>
          </div>
        </div>
        {pageIndicator && (
          <div className="flex mt-1 sm:mt-0">{pageIndicator}</div>
        )}
      </div>
    </div>
  );
}
