"use client";
import { PageLoading } from "@/components/ui/Loading";
import { orderApi } from "@/lib/api/order";
import { toastError, toastSuccess } from "@/lib/toast";
import { OrderItem as OrderItemType, OrderItems } from "@/types/order";
import { formatMeters, toMeters } from "@/types/item";
import { useState, useEffect } from "react";

import { OrderItemRow } from "@/components/order";
import OrderItemEditModal from "./orderItemEdit";
import {
  isOrderItemFullyPacked,
  outstandingMeters,
  sortOrderItemsUnpackedFirst,
} from "@/lib/utils/orderItemSort";

type Props = {
  items: OrderItems | undefined;
  isDeletable?: boolean;
  isEditable?: boolean;
  orderId?: number;
  onAllocationChange?: () => void;
  onDeleteItem?: (itemId: number) => void;
  /** Hide unfulfilled lines -- used on the dispatch screen. */
  onlyFullyPacked?: boolean;
  outstandingItemIds?: number[];
};

/**
 * The fabric lines on an order.
 *
 * There is no per-line "packed" tick any more: cloth is allocated in packing
 * rounds, which is where stock actually moves. What this list shows is how much
 * of each line the warehouse has committed, and how much is still owed.
 */
const OrderItem: React.FC<Props> = ({
  items,
  isDeletable,
  isEditable,
  orderId,
  onAllocationChange,
  onDeleteItem,
  onlyFullyPacked = false,
  outstandingItemIds = [],
}) => {
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [orderItems, setOrderItems] = useState(items);
  const [editingItem, setEditingItem] = useState<OrderItemType | null>(null);
  const [editMetres, setEditMetres] = useState("0");
  const [editVariantId, setEditVariantId] = useState<number | null>(null);
  const [metresError, setMetresError] = useState<string | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);

  useEffect(() => {
    setOrderItems(items);
  }, [items]);

  const onDelete = async (itemId: number) => {
    if (!orderId) return;
    try {
      setDeleting(true);
      await orderApi.deleteItem(orderId, itemId);
      setOrderItems((prev) => prev?.filter((item) => item.id !== itemId));
      onDeleteItem?.(itemId);
    } catch (err) {
      toastError("Failed to remove fabric line", err);
    } finally {
      setDeleting(false);
    }
  };

  const handleEditItem = (item: OrderItemType) => {
    setEditingItem(item);
    setEditMetres(item.ordered_quantity);
    setEditVariantId(item.variant);
    setMetresError(null);
    setShowEditDialog(true);
  };

  const saveEditItem = async () => {
    if (!editingItem) return;

    const metres = toMeters(editMetres);
    if (metres <= 0) {
      setMetresError("Enter how many metres are needed.");
      return;
    }
    // The API refuses to shrink a line below what packing has already committed,
    // so surface that here rather than making the admin guess.
    const alreadyPacked = toMeters(editingItem.allocated_quantity);
    if (metres < alreadyPacked) {
      setMetresError(
        `${formatMeters(alreadyPacked)} m of this fabric is already packed. Cancel the packing round first.`,
      );
      return;
    }

    try {
      setSaving(true);
      await orderApi.updateItem(editingItem.id, {
        ordered_quantity: editMetres,
        variant: editVariantId,
      });
      setOrderItems((prev) =>
        prev?.map((item) =>
          item.id === editingItem.id
            ? {
                ...item,
                // Both fields can change, so keep the local copy in step or the
                // row shows the old colour until the next refetch.
                ordered_quantity: editMetres,
                variant: editVariantId ?? item.variant,
                allocated_quantity:
                  toMeters(editMetres) < toMeters(item.allocated_quantity)
                    ? editMetres
                    : item.allocated_quantity,
              }
            : item,
        ),
      );
      toastSuccess("Fabric line updated");
      setShowEditDialog(false);
      setEditingItem(null);
      onAllocationChange?.();
    } catch (err) {
      // Keep the dialog open with the typed values so the admin can correct
      // them instead of retyping the whole line.
      toastError("Failed to update fabric line", err);
    } finally {
      setSaving(false);
    }
  };

  if (!items) return <PageLoading />;

  const visibleItems = sortOrderItemsUnpackedFirst(
    orderItems?.filter((item) => (onlyFullyPacked ? isOrderItemFullyPacked(item) : true)) ??
      [],
  );

  return (
    <>
      <div className="pt-0 space-y-1">
        {visibleItems.map((item) => {
          const stillOwed = outstandingMeters(item);

          return (
            <OrderItemRow
              key={item.id}
              item={item}
              showDelete={isDeletable}
              showEdit={isEditable}
              isPacked={stillOwed === 0}
              isOutOfStock={outstandingItemIds.includes(item.id)}
              onDelete={(deleteItemId) => onDelete(deleteItemId)}
              onEdit={isEditable ? handleEditItem : undefined}
            />
          );
        })}
      </div>

      {showEditDialog && editingItem && (
        <OrderItemEditModal
          item={editingItem}
          metres={editMetres}
          variantId={editVariantId}
          metresError={metresError}
          setMetres={setEditMetres}
          setVariantId={setEditVariantId}
          setMetresError={setMetresError}
          saving={saving}
          onClose={() => {
            if (saving) return;
            setShowEditDialog(false);
            setEditingItem(null);
          }}
          onSave={saveEditItem}
        />
      )}
    </>
  );
};

export default OrderItem;
