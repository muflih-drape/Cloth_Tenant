"use client";

import { Order, OrderStatus } from "@/types/order";
import { useRouter } from "next/navigation";
import StockflowAvatar from "../ui/custom/stockflowAvatar";
import { markOrderAsViewed } from "@/lib/viewedOrders";

interface OrderCardProps {
  order: Order;
  onClick?: () => void;
  viewed?: boolean;
}

const statusConfig: Record<
  OrderStatus,
  { bg: string; text: string; label: string }
> = {
  DRAFT: {
    bg: "bg-gray-100",
    text: "text-gray-600",
    label: "Draft",
  },
  PENDING: {
    bg: "bg-amber-100",
    text: "text-amber-700",
    label: "Pending",
  },
  EDITING: {
    bg: "bg-purple-100",
    text: "text-purple-700",
    label: "Editing",
  },
  PACKED: {
    bg: "bg-blue-100",
    text: "text-blue-700",
    label: "Packed",
  },
  DISPATCHED: {
    bg: "bg-green-100",
    text: "text-green-700",
    label: "Dispatched",
  },
};

export default function OrderCard({
  order,
  onClick,
  viewed = false,
}: OrderCardProps) {
  const router = useRouter();
  const status = statusConfig[order.status || "PENDING"];

  const totalSets = order.total_sets || 0;
  const totalPieces = order.total_pieces || 0;
  const unpackedCount =
    order.items?.filter((item) => (item.packed_quantity ?? 0) === 0).length ?? 0;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
    });
  };

  const handleClick = () => {
    markOrderAsViewed(order.id);
    if (onClick) {
      onClick();
    } else {
      router.push(`/admin/order/status/${order.id}`);
    }
  };

  return (
    <div
      onClick={handleClick}
      className={` border ${
        viewed
          ? "border-gray-100 bg-white"
          : "border-gray-300 bg-gray-50 shadow-sm"
      } p-4 rounded-2xl hover:border-primary/30 hover:shadow-md transition-all cursor-pointer active:scale-[0.99] relative`}
    >
      {!viewed && (
        <div className="absolute top-2 right-2 w-4 h-4 rounded-full animate-pulse bg-green-600" />
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

        <div>
          <div
            className={`px-2 py-1 flex items-center justify-center rounded-full text-[10px] font-bold uppercase tracking-wide flex-shrink-0 ${status.bg} ${status.text}`}
          >
            {status.label}
          </div>
          <div
            className={`px-2 py-1 rounded-full text-[12px] text-gray-600 font-bold uppercase tracking-wide flex-shrink-0`}
          >
            ID #{order.id}
          </div>
          {unpackedCount > 0 && (
            <div className="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide flex-shrink-0 bg-green-100 text-green-700 mt-1">
              <span className="text-xl " >{unpackedCount}</span> Unpacked
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-50">

        <div className="flex flex-col items-start gap-1.5">

          <div className="text-sm font-bold text-gray-600">
            {new Date(order.created_at).toLocaleString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            })}
          </div>
          <div>
            <span className="text-base font-black text-gray-900">
              {totalSets}
            </span>
            <span className="text-xs text-gray-400"> Sets</span>
            <span className="text-gray-300 mx-1">•</span>
            <span className="text-sm font-bold text-gray-600">{totalPieces}</span>
            <span className="text-xs text-gray-400"> pcs</span>
          </div>
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
