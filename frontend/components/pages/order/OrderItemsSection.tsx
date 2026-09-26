"use client";
import { CheckCircle2, PackageCheck } from "lucide-react";
import { OrderItem as OrderItemType } from "@/types/order";
import OrderItem from "@/components/pages/admin/order-item/OrderItem";

interface OrderItemsSectionProps {
  items?: OrderItemType[];
  activeTab: string;
  isPackingMode: boolean;
  onPackedChange: () => void;
  onTogglePackingMode: () => void;
  status?: string;
  orderId?: number;
}

export default function OrderItemsSection({
  items,
  activeTab,
  isPackingMode,
  onPackedChange,
  onTogglePackingMode,
  status,
  orderId,
}: OrderItemsSectionProps) {
  const isEditable =
    status === "DRAFT" || status === "PENDING" || status === "PACKED";

  return (
    <>
      <div className="flex justify-between items-end mb-4 border-b border-gray-100 pb-2">
        <div>
          <h2 className="text-lg font-extrabold text-gray-900 leading-tight">
            Items to {activeTab}
          </h2>
          <p className="text-xs text-gray-400 font-medium">
            Manage order items below
          </p>
        </div>

        {activeTab === "Packing" && status !== "DISPATCHED" && (
          <button
            onClick={onTogglePackingMode}
            className={`px-4 py-2 rounded-md flex gap-2 items-center font-bold text-sm transition-all ${
              isPackingMode
                ? "bg-green-600 text-white shadow-lg"
                : "bg-primary text-white shadow-md"
            }`}
          >
            {isPackingMode ? (
              <>
                <CheckCircle2 size={18} />
                <span>Done Selecting</span>
              </>
            ) : (
              <>
                <PackageCheck size={18} />
                <span>Update Packing</span>
              </>
            )}
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl overflow-hidden">
        <OrderItem
          items={items}
          isPacking={isPackingMode && activeTab === "Packing"}
          isDispatching={activeTab === "Dispatching"}
          onPackedChange={onPackedChange}
          isDeletable={isEditable}
          orderId={orderId}
          onDeleteItem={onPackedChange}
          status={status}
        />
      </div>
    </>
  );
}
