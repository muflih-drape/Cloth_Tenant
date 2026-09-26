"use client";

import { AlertTriangle, Scissors } from "lucide-react";
import Link from "next/link";
import { OrderItem as OrderItemType } from "@/types/order";
import { formatMeters, toMeters } from "@/types/item";
import OrderItem from "@/components/pages/admin/order-item/OrderItem";

interface OrderItemsSectionProps {
  items?: OrderItemType[];
  status?: string;
  orderId?: number;
  onItemsChange: () => void;
}

/**
 * The fabric lines on an order, with a running picture of what the warehouse
 * still owes. Packing is not done here -- cloth is allocated in packing rounds,
 * so the only action this screen offers is the way into them.
 */
export default function OrderItemsSection({
  items,
  status,
  orderId,
  onItemsChange,
}: OrderItemsSectionProps) {
  const lines = items ?? [];
  const ordered = lines.reduce((sum, i) => sum + toMeters(i.ordered_quantity), 0);
  const allocated = lines.reduce((sum, i) => sum + toMeters(i.allocated_quantity), 0);
  const outstanding = lines.reduce(
    (sum, i) => sum + toMeters(i.outstanding_quantity),
    0,
  );

  // Lines can only be edited while the order is still open for changes, and
  // never once cloth has moved against them.
  const isEditable = status === "DRAFT" || status === "PENDING" || status === "EDITING";
  const isDeletable = isEditable;
  const awaitingPacking = outstanding > 0 && status !== "DISPATCHED";

  return (
    <>
      <div className="mb-4 border-b border-gray-100 pb-2">
        <h2 className="text-lg font-extrabold text-gray-900 leading-tight">
          Fabric lines
        </h2>
        <p className="text-xs text-gray-400 font-medium">
          {formatMeters(ordered)} m ordered · {formatMeters(allocated)} m packed
        </p>
      </div>

      {awaitingPacking && (
        <div className="mb-3 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle size={18} className="shrink-0 text-amber-600" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-amber-900">
              {formatMeters(outstanding)} m still to pack
            </p>
            <p className="text-[11px] text-amber-700">
              Allocated in a packing round, which moves the stock.
            </p>
          </div>
          <Link
            href="/admin/packing"
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-[11px] font-bold text-white hover:bg-amber-600 transition-colors"
          >
            <Scissors size={13} />
            Pack
          </Link>
        </div>
      )}

      <div className="bg-white rounded-2xl overflow-hidden">
        <OrderItem
          items={items}
          isDeletable={isDeletable}
          isEditable={isEditable}
          orderId={orderId}
          onAllocationChange={onItemsChange}
          onDeleteItem={onItemsChange}
        />
      </div>
    </>
  );
}
