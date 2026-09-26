"use client";
import { OrderAllResponse } from "@/types/order";
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
  if (order.items.length === 0) return null;

  const viewed = true; // Temporary removal

  const handleClick = () => {
    markOrderAsViewed(order.id);
    onClick();
  };

  const totalSets =
    order.total_sets ||
    order.items.reduce((sum, item) => sum + item.quantity, 0);
  const totalPieces =
    order.total_pieces ||
    order.items.reduce(
      (sum, item) => sum + item.quantity * (item.piece_count || 1),
      0,
    );

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
              {order.agent_details.username}
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
          <span className="text-base font-black text-gray-900">
            {totalSets}
          </span>
          <span className="text-xs text-gray-400">Sets</span>
          <span className="text-gray-300 mx-1">•</span>
          <span className="text-sm font-bold text-gray-600">{totalPieces}</span>
          <span className="text-xs text-gray-400">pcs</span>
        </div>

        <div className="text-right">
          <span className="text-sm font-black text-primary">
            ₹
            {order.items
              ?.reduce(
                (sum, item) =>
                  sum +
                  (Number(item.item_price) || 0) *
                    item.quantity *
                    (item.piece_count || 1),
                0,
              )
              .toLocaleString("en-IN")}
          </span>
        </div>
      </div>
    </div>
  );
}
