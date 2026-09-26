"use client";
import { PageLoading } from "@/components/ui/Loading";
import { orderApi } from "@/lib/api/order";
import { itemApi } from "@/lib/api/item";
import { toastError, toastSuccess } from "@/lib/toast";
import { OrderItem as OrderItemType, OrderItems } from "@/types/order";
import { VariantSize, ItemType } from "@/types/item";
import { useState, useEffect } from "react";

import { OrderItemRow } from "@/components/order";
import OrderItemEditModal from "./orderItemEdit";
import {
  isOrderItemFullyPacked,
  sortOrderItemsUnpackedFirst,
} from "@/lib/utils/orderItemSort";

import {
  getAvailableSizeGroups,
  getAvailableStockForSizeGroup,
  getPiecesForGroup,
} from "./orderItemUtils";

type Props = {
  items: OrderItems | undefined;
  isDeletable?: boolean;
  isEditable?: boolean;
  orderId?: number;
  isPacking?: boolean;
  isDispatching?: boolean;
  onPackedChange?: () => void;
  onDeleteItem?: (itemId: number) => void;
  status?: string;
  outOfStockItemIds?: number[];
};

const OrderItem: React.FC<Props> = ({
  items,
  isDeletable,
  isEditable,
  orderId,
  isPacking,
  isDispatching,
  onPackedChange,
  onDeleteItem,
  status,
  outOfStockItemIds = [],
}) => {
  const [loading, setLoading] = useState(false);
  const [loadingItemId, setLoadingItemId] = useState<number | null>(null);
  const [orderItems, setOrderItems] = useState(items);
  const [showUnpackDialog, setShowUnpackDialog] = useState(false);
  const [pendingUnpack, setPendingUnpack] = useState<{
    itemId: number;
    newPacked: number;
  } | null>(null);
  const [editingItem, setEditingItem] = useState<OrderItemType | null>(null);
  const [editQuantity, setEditQuantity] = useState(1);
  const [editSizeGroup, setEditSizeGroup] = useState("");
  const [editPieceCount, setEditPieceCount] = useState(1);
  const [editPackedQty, setEditPackedQty] = useState(0);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [sizeGroupOptions, setSizeGroupOptions] = useState<string[]>([]);
  const [variantSizes, setVariantSizes] = useState<VariantSize[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [sizeGroupError, setSizeGroupError] = useState<string | null>(null);
  const [quantityError, setQuantityError] = useState<string | null>(null);

  useEffect(() => {
    setOrderItems(items);
  }, [items]);

  const handleTogglePacked = async () => {
    if (!pendingUnpack) return;
    const { itemId, newPacked } = pendingUnpack;

    try {
      setLoadingItemId(pendingUnpack.itemId);
      await orderApi.updateItem(itemId, { packed_quantity: newPacked });

      if (status === "PACKED" && orderId) {
        await orderApi.update(orderId, { status: "PENDING" });
        toastSuccess("Order status changed to PENDING");
      }

      setOrderItems((prev) =>
        prev?.map((item) =>
          item.id === itemId ? { ...item, packed_quantity: newPacked } : item,
        ),
      );
      if (onPackedChange) onPackedChange();
    } catch (err) {
      console.error("Error updating packed status:", err);
      toastError("Failed to update packed status");
    } finally {
      setLoadingItemId(null);
      setShowUnpackDialog(false);
      setPendingUnpack(null);
    }
  };

  const togglePacked = async (
    itemId: number,
    currentPacked: number,
    totalPieces: number,
  ) => {
    const newPacked = currentPacked >= totalPieces ? 0 : totalPieces;

    if (status === "PACKED" && newPacked < currentPacked) {
      setPendingUnpack({ itemId, newPacked });
      setShowUnpackDialog(true);
      return;
    }

    try {
      const updatePromise = orderApi.updateItem(itemId, {
        packed_quantity: newPacked,
      });
      const statusChanged = status === "PACKED" && orderId;
      const statusPromise =
        status === "PACKED" && orderId
          ? orderApi.update(orderId, { status: "PENDING" })
          : Promise.resolve();

      setLoadingItemId(itemId);
      await Promise.all([updatePromise, statusPromise]);

      if (statusChanged) {
        toastSuccess("Order status changed to PENDING");
      }

      setOrderItems((prev) =>
        prev?.map((item) =>
          item.id === itemId ? { ...item, packed_quantity: newPacked } : item,
        ),
      );
      if (statusChanged && onPackedChange) onPackedChange();
    } catch (err) {
      console.error("Error updating packed status:", err);
      toastError("Failed to update packed status");
    } finally {
      setLoadingItemId(null);
    }
  };

  const onDelete = async (itemId: number, orderId?: number) => {
    if (!orderId) return;
    try {
      setLoading(true);
      await orderApi.deleteItem(orderId, itemId);
      setOrderItems((prev) => prev?.filter((item) => item.id !== itemId));
      if (onDeleteItem) onDeleteItem(itemId);
    } catch (err) {
      toastError("Failed to delete item", err);
    } finally {
      setLoading(false);
    }
  };

  const handleEditItem = async (item: OrderItemType) => {
    setEditingItem(item);
    setEditQuantity(item.quantity);
    setEditSizeGroup(item.size_group || "");
    setEditPieceCount(item.piece_count || 1);
    setEditPackedQty(item.packed_quantity || 0);
    setShowEditDialog(true);
    setSizeGroupError(null);
    setQuantityError(null);
    setVariantsLoading(true);

    try {
      const variants = await itemApi.getAllVariants();

      const variantId = item.variant;
      const variant = variants.find((v) => v.id === variantId);
      const itemType = item.item_type as ItemType | undefined;
      if (variant && itemType) {
        const validItemType =
          itemType === "kids" || itemType === "gents" ? itemType : "gents";
        const availableGroups = getAvailableSizeGroups(
          variant.sizes || [],
          validItemType,
        );
        setSizeGroupOptions(availableGroups);
        setVariantSizes(variant.sizes || []);

        const pieceCount = getPiecesForGroup(item.size_group || "");
        setEditPieceCount(pieceCount > 0 ? pieceCount : item.piece_count || 1);

        if (availableGroups.length === 0) {
          setSizeGroupError("No sizes available for this variant");
        } else if (!availableGroups.includes(item.size_group || "")) {
          setSizeGroupError("Current size group is no longer available");
        }
      }
    } catch (err) {
      console.error("Error fetching variants:", err);
    } finally {
      setVariantsLoading(false);
    }
  };

  const saveEditItem = async () => {
    if (!editingItem || !orderId) return;
    if (editQuantity < 1) {
      toastError("Quantity must be at least 1");
      return;
    }
    if (!editSizeGroup) {
      toastError("Please select a size group");
      return;
    }

    const reservedItems =
      orderItems
        ?.filter(
          (orderItem) =>
            orderItem.item == editingItem.item &&
            orderItem.variant == editingItem.variant &&
            orderItem.id != editingItem.id,
        )
        .map((item) => ({
          size_group: item.size_group || "",
          quantity: item.quantity,
        })) || [];

    const maxAvailable = getAvailableStockForSizeGroup(
      variantSizes,
      editSizeGroup,
      reservedItems,
    );
    if (editQuantity > maxAvailable) {
      setQuantityError(
        `Only ${maxAvailable} sets available for this size group`,
      );
      return;
    }

    try {
      setLoading(true);
      const newPackedQty = Math.min(
        editPackedQty,
        editQuantity * editPieceCount,
      );
      await orderApi.updateItem(editingItem.id, {
        quantity: editQuantity,
        size_group: editSizeGroup,
        packed_quantity: newPackedQty,
      });
      setOrderItems((prev) =>
        prev?.map((item) =>
          item.id === editingItem.id
            ? {
                ...item,
                quantity: editQuantity,
                size_group: editSizeGroup,
                packed_quantity: newPackedQty,
                piece_count: editPieceCount,
              }
            : item,
        ),
      );
      toastSuccess("Item updated successfully");
    } catch (err: any) {
      console.error("Error updating item:", err);
      toastError(
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error || "Failed to update item",
      );
    } finally {
      setLoading(false);
      setShowEditDialog(false);
      setEditingItem(null);
    }
  };

  if (loading) return <PageLoading />;

  return (
    <>
      <div className="pt-0 space-y-1">
        {sortOrderItemsUnpackedFirst(
          orderItems?.filter((item) => {
            if (!isDispatching) return true;
            return isOrderItemFullyPacked(item);
          }) ?? [],
        ).map((item) => {
          const totalPieces = (item.piece_count || 1) * item.quantity;
          const isFullyPacked = (item.packed_quantity ?? 0) >= totalPieces;

          return (
            <OrderItemRow
              key={item.id}
              item={item}
              showDelete={isDeletable}
              showEdit={isEditable}
              showPackedToggle={isPacking}
              isLoading={loadingItemId === item.id}
              isPacked={isFullyPacked}
              isOutOfStock={outOfStockItemIds.includes(item.id)}
              onDelete={(deleteItemID) => onDelete(deleteItemID, orderId)}
              onEdit={isEditable ? handleEditItem : undefined}
              onTogglePacked={(id, packed) => {
                void packed;
                togglePacked(id, item.packed_quantity ?? 0, totalPieces);
              }}
            />
          );
        })}
      </div>

      {showUnpackDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              Unpack Items?
            </h3>
            <p className="text-sm text-gray-500 mb-6">
              Order is currently marked as packed. Unpacking items will change
              the order status back to PENDING. Continue?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowUnpackDialog(false);
                  setPendingUnpack(null);
                }}
                className="flex-1 py-3 px-4 rounded-xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleTogglePacked}
                className="flex-1 py-3 px-4 rounded-xl bg-primary text-white font-medium hover:bg-primary/90 transition-colors"
              >
                Unpack
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditDialog && editingItem && (
        <OrderItemEditModal
          editingItem={editingItem}
          editQuantity={editQuantity}
          editSizeGroup={editSizeGroup}
          editPieceCount={editPieceCount}
          variantsLoading={variantsLoading}
          sizeGroupOptions={sizeGroupOptions}
          variantSizes={variantSizes}
          sizeGroupError={sizeGroupError}
          quantityError={quantityError}
          orderItems={orderItems}
          setEditSizeGroup={setEditSizeGroup}
          setEditQuantity={setEditQuantity}
          setEditPieceCount={setEditPieceCount}
          setSizeGroupError={setSizeGroupError}
          setQuantityError={setQuantityError}
          setShowEditDialog={setShowEditDialog}
          setEditingItem={setEditingItem}
          saveEditItem={saveEditItem}
        />
      )}
    </>
  );
};

export default OrderItem;
