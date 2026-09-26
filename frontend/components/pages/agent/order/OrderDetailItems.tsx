"use client";
import { useState } from "react";
import { OrderItem as OrderItemType } from "@/types/order";
import OrderItem from "@/components/pages/admin/order-item/OrderItem";
import { toastSuccess, toastError } from "@/lib/toast";
import { orderApi } from "@/lib/api/order";

interface OrderDetailItemsProps {
  items?: OrderItemType[];
  orderId?: number;
  status?: string;
  onRefresh?: () => void;
}

export default function OrderDetailItems({
  items,
  orderId,
  status,
  onRefresh,
}: OrderDetailItemsProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<number | null>(null);

  const handleDeleteClick = (itemId: number) => {
    setItemToDelete(itemId);
    setShowDeleteDialog(true);
  };

  const confirmDelete = async () => {
    if (!itemToDelete || !orderId) return;
    try {
      await orderApi.deleteItem(orderId, itemToDelete);
      toastSuccess("Item deleted successfully");
      setShowDeleteDialog(false);
      setItemToDelete(null);
      if (onRefresh) onRefresh();
    } catch (err) {
      toastError("Failed to delete item");
      console.error(err);
    }
  };

  const isEditable =
    status === "DRAFT" || status === "PENDING" || status === "PACKED";

  return (
    <>
      <div className="flex justify-between items-end mb-4 border-b border-gray-100 pb-2">
        <div>
          <h2 className="text-lg font-extrabold text-gray-900 leading-tight">
            Items
          </h2>
          <p className="text-xs text-gray-400 font-medium">Order items below</p>
        </div>
        {status && status !== "DISPATCHED" && status !== "DRAFT" && (
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
            Packing Status
          </span>
        )}
      </div>

      <div className="bg-white rounded-2xl overflow-hidden">
        <OrderItem
          items={items}
          isDeletable={false}
          orderId={orderId}
          onDeleteItem={handleDeleteClick}
        />
      </div>

      {showDeleteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              Delete Item?
            </h3>
            <p className="text-sm text-gray-500 mb-6">
              {status !== "DRAFT"
                ? "This will return the stock back to the warehouse. This action cannot be undone."
                : "Are you sure you want to remove this item from the order?"}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteDialog(false)}
                className="flex-1 py-3 px-4 rounded-xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 py-3 px-4 rounded-xl bg-red-500 text-white font-medium hover:bg-red-600 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
