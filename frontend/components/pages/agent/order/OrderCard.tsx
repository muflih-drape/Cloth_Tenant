"use client";
import { OrderAllResponse } from "@/types/order";
import { formatMeters, toMeters } from "@/types/item";
import StatusBadge from "@/components/ui/custom/StatusBadge";
import { User } from "lucide-react";
import { getColorFromId } from "@/util/getColorFromId";
import { markOrderAsViewed } from "@/lib/viewedOrders";
import StockflowAvatar from "@/components/ui/custom/stockflowAvatar";

interface OrderCardProps {
  order: OrderAllResponse[number];
  onClick: () => void;
}

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });
};

export default function OrderCard({ order, onClick }: OrderCardProps) {
  const viewed = true; // Temporary removal

  const handleClick = () => {
    markOrderAsViewed(order.id);
    onClick();
  };

  const totalOrderedMeters = toMeters(order.totals?.total_ordered_meters);
  const totalOutstandingMeters = toMeters(order.totals?.total_outstanding_meters);
  // An order can be stranded with no lines at all. It still has to be listed --
  // hiding it makes the order count and the rows disagree -- but flag it so it
  // reads as broken rather than as a normal zero-metre order.
  const hasItems = (order.items?.length ?? 0) > 0;

  return (
    <div
      onClick={handleClick}
      className="bg-white border border-gray-100 p-4 rounded-2xl hover:border-primary/30 hover:shadow-md transition-all cursor-pointer active:scale-[0.99] relative"
    >
      {!viewed && (
        <div className="absolute top-3 right-3 w-2.5 h-2.5 bg-primary rounded-full" />
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <StockflowAvatar user={order.customer_details} />
          <div className="min-w-0">
            <h6
              className={`font-bold text-xs ${!viewed ? "text-gray-900" : "text-gray-700"}`}
            >
              {order.customer_details?.name || "Unknown Customer"}
            </h6>
            <p className="text-xs text-gray-400 mt-0.5">
              {order.agent_details?.username ?? "Unassigned"}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {formatDate(order.created_at)}
            </p>
          </div>
        </div>

        <StatusBadge status={order.status} />
      </div>

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-50">
        <div className="flex items-center gap-1.5">
          {hasItems ? (
            <>
              <span className="text-base font-black text-gray-900">
                {formatMeters(totalOrderedMeters)}
              </span>
              <span className="text-xs text-gray-400">m</span>
            </>
          ) : (
            <span className="text-xs font-semibold text-red-500">
              No items on this order
            </span>
          )}
          {hasItems && totalOutstandingMeters > 0 && (
            <>
              <span className="text-gray-300 mx-1">•</span>
              <span className="text-sm font-bold text-amber-600">
                {formatMeters(totalOutstandingMeters)}
              </span>
              <span className="text-xs text-amber-600">to pack</span>
            </>
          )}
        </div>

        <div className="text-right">
          <span className="text-sm font-black text-primary">
            ₹
            {Number(order.totals?.effective_total || 0).toLocaleString("en-IN")}
          </span>
        </div>
      </div>
    </div>
  );
}
