"use client";
import { useState } from "react";
import {
  Trash2,
  CheckCircle2,
  Circle,
  Pencil,
  AlertTriangle,
} from "lucide-react";
import { ImagePreview } from "@/components/pages/ImagePreview";
import { OrderItem } from "@/types/order";
import { formatMeters, toMeters } from "@/types/item";
import { orderItemColorSuffix } from "@/lib/colorLabel";
import { Spinner } from "../ui/spinner";
import { outstandingMeters } from "@/lib/utils/orderItemSort";
import type { ReactNode } from "react";

// ─── Delete Confirmation Dialog ───────────────────────────────────────────────
interface DeleteConfirmDialogProps {
  item: OrderItem;
  isOpen: boolean;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteConfirmDialog({
  item,
  isOpen,
  isDeleting,
  onConfirm,
  onCancel,
}: DeleteConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      onClick={onCancel}
    >
      {/* Dialog panel */}
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top accent strip */}
        <div className="h-1 w-full bg-red-500" />

        <div className="p-6">
          {/* Icon + heading */}
          <div className="flex items-start gap-4 mb-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 leading-tight">
                Remove this fabric?
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                This action cannot be undone.
              </p>
            </div>
          </div>

          {/* Line preview */}
          <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5 mb-6 border border-gray-100">
            <div className="relative w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 border border-gray-200 bg-gray-100">
              {item.variant_image ? (
                <ImagePreview
                  src={item.variant_image}
                  alt={item.fabric_name}
                />
              ) : (
                <div className="w-full h-full bg-gray-200" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 truncate">
                {item.fabric_name}
              </p>
              <p className="text-xs text-gray-400">
                {item.variant_display_order || "No colour"}
              </p>
            </div>
            <span className="text-sm font-bold text-gray-900 flex-shrink-0">
              ₹{Number(item.line_total || 0).toLocaleString("en-IN")}
            </span>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              disabled={isDeleting}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={isDeleting}
              className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 active:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {isDeleting ? (
                <>
                  <Spinner className="w-4 h-4" />
                  <span>Removing…</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  <span>Remove</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── OrderItemRow ─────────────────────────────────────────────────────────────
interface OrderItemRowProps {
  item: OrderItem;
  onDelete?: (itemId: number) => void | Promise<void>;
  onEdit?: (item: OrderItem) => void;
  onTogglePacked?: (itemId: number, packed: boolean) => void;
  showDelete?: boolean;
  showEdit?: boolean;
  showPackedToggle?: boolean;
  isPacked?: boolean;
  isOutOfStock?: boolean;
  isLoading?: boolean;
  /**
   * Rendered inside this line's card, underneath the summary row. Used by the
   * admin order page to hang the per-line packing control off the same card
   * instead of a second card beside it. Left undefined everywhere else, so
   * every other screen renders exactly as before.
   */
  footer?: ReactNode;
}

export default function OrderItemRow({
  item,
  onDelete,
  onEdit,
  onTogglePacked,
  showDelete = false,
  showEdit = false,
  showPackedToggle = false,
  isPacked = false,
  isOutOfStock = false,
  isLoading = false,
  footer,
}: OrderItemRowProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const ordered = toMeters(item.ordered_quantity);
  const allocated = toMeters(item.allocated_quantity);
  const outstanding = outstandingMeters(item);

  const handleDeleteConfirm = async () => {
    if (!onDelete) return;
    setIsDeleting(true);
    try {
      await onDelete(item.id);
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  return (
    <>
      <DeleteConfirmDialog
        item={item}
        isOpen={showDeleteDialog}
        isDeleting={isDeleting}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setShowDeleteDialog(false)}
      />

      <div
        className={`border-b border-gray-50 ${
          isPacked ? "bg-green-50" : isOutOfStock ? "bg-red-50" : "bg-white"
        }`}
      >
        <div className="flex items-center gap-3 py-4 px-1">
          <div>
            {showEdit && onEdit && (
              <button
                onClick={() => onEdit(item)}
                className="flex items-center justify-center p-2 flex-shrink-0"
              >
                <Pencil className="text-primary w-4 h-4" />
              </button>
            )}
            {showDelete && onDelete && (
              <button
                onClick={() => setShowDeleteDialog(true)}
                className="flex items-center justify-center p-2 flex-shrink-0 hover:cursor-pointer"
              >
                <Trash2 className="text-red-500 w-4 h-4" />
              </button>
            )}
          </div>

          {showPackedToggle && onTogglePacked && (
            <button
              onClick={() => !isLoading && onTogglePacked(item.id, !isPacked)}
              className="flex items-center justify-center p-2 mr-1 flex-shrink-0"
            >
              {isLoading ? (
                <Spinner className="w-6 h-6" />
              ) : isPacked ? (
                <CheckCircle2 className="text-green-600 w-6 h-6" />
              ) : (
                <Circle className="text-gray-300 w-6 h-6 hover:text-primary/50 transition-colors" />
              )}
            </button>
          )}

          <div className="relative w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 border border-gray-100 bg-gray-50">
            {item.variant_image ? (
              <ImagePreview src={item.variant_image} alt={item.fabric_name} />
            ) : (
              <div className="w-full h-full bg-gray-100" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h6
              className={`font-semibold text-sm truncate ${
                isPacked
                  ? "text-green-700"
                  : isOutOfStock
                    ? "text-red-700"
                    : "text-gray-900"
              }`}
            >
              {item.fabric_name}
              {orderItemColorSuffix(item.variant_display_order)}
            </h6>
            <p
              className={`text-xs font-medium mt-1 ${
                isPacked
                  ? "text-green-600"
                  : isOutOfStock
                    ? "text-red-600"
                    : "text-gray-600"
              }`}
            >
              {formatMeters(ordered)} m ordered
              {outstanding > 0 ? (
                <>
                  {" · "}
                  <span className="font-bold text-amber-600">
                    {formatMeters(outstanding)} m awaiting packing
                  </span>
                </>
              ) : (
                <span className="text-green-600"> · fully packed</span>
              )}
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              ₹{Number(item.rate_per_meter || 0).toLocaleString("en-IN")}/m
            </p>
          </div>

          <div className="text-right flex-shrink-0">
            <span
              className={`text-base font-black ${isOutOfStock ? "text-red-700" : "text-gray-900"}`}
            >
              ₹{Number(item.line_total || 0).toLocaleString("en-IN")}
            </span>
          </div>
        </div>

        {footer}
      </div>
    </>
  );
}
