import { VariantSize } from "@/types/item";
import { OrderItem, OrderItems } from "@/types/order";
import {
  getAvailableStockForSizeGroup,
  getPiecesForGroup,
} from "./orderItemUtils";

interface OrderItemEditModalProps {
  editingItem: OrderItem;
  editQuantity: number;
  editSizeGroup: string;
  editPieceCount: number;
  variantsLoading: boolean;
  sizeGroupOptions: string[];
  variantSizes: VariantSize[];
  sizeGroupError: string | null;
  quantityError: string | null;
  orderItems: OrderItems | undefined;
  setEditSizeGroup: (val: string) => void;
  setEditQuantity: (val: number) => void;
  setEditPieceCount: (val: number) => void;
  setSizeGroupError: (val: string | null) => void;
  setQuantityError: (val: string | null) => void;
  setShowEditDialog: (val: boolean) => void;
  setEditingItem: (val: OrderItem | null) => void;
  saveEditItem: () => void;
}

const OrderItemEditModal: React.FC<OrderItemEditModalProps> = ({
  editingItem,
  editQuantity,
  editSizeGroup,
  editPieceCount,
  variantsLoading,
  sizeGroupOptions,
  variantSizes,
  sizeGroupError,
  quantityError,
  orderItems,
  setEditSizeGroup,
  setEditQuantity,
  setEditPieceCount,
  setSizeGroupError,
  setQuantityError,
  setShowEditDialog,
  setEditingItem,
  saveEditItem,
}) => {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-bold text-gray-900 mb-1">Edit Item</h3>
        <p className="text-sm text-gray-500 mb-4">{editingItem.item_name}</p>

        {variantsLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
          </div>
        ) : sizeGroupOptions.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm text-red-500 font-medium">
              No sizes available
            </p>
            <button
              onClick={() => {
                setShowEditDialog(false);
                setEditingItem(null);
              }}
              className="mt-4 w-full py-3 px-4 rounded-xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="mb-4">
              <div className="flex justify-between">
                <div className="flex flex-col justify-between h-full">
                  <label className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                    Size Group:
                  </label>
                </div>

                <p className="text-lg">{editSizeGroup}</p>
              </div>

              {editSizeGroup &&
                variantSizes.length > 0 &&
                (() => {
                  return (
                    <div className="flex w-full justify-end mt-1">
                      <p className="text-xs text-gray-500">
                        {editPieceCount} pcs/set
                      </p>
                    </div>
                  );
                })()}
            </div>

            <div className="mb-4">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Quantity (sets)
              </label>
              <input
                type="number"
                min="1"
                value={editQuantity}
                onChange={(e) => {
                  setEditQuantity(Math.max(1, parseInt(e.target.value) || 1));
                  setQuantityError(null);
                }}
                className={`w-full mt-1 px-4 py-3 rounded-xl border text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                  quantityError ? "border-red-300" : "border-gray-200"
                }`}
              />
              {quantityError && (
                <p className="text-xs text-red-500 mt-1">{quantityError}</p>
              )}
              {editSizeGroup &&
                !quantityError &&
                variantSizes.length > 0 &&
                (() => {
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

                  const available = getAvailableStockForSizeGroup(
                    variantSizes,
                    editSizeGroup,
                    reservedItems,
                  );
                  return (
                    <p className="text-xs text-gray-500 mt-1">
                      Max available: {available} sets
                    </p>
                  );
                })()}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowEditDialog(false);
                  setEditingItem(null);
                }}
                className="flex-1 py-3 px-4 rounded-xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveEditItem}
                disabled={
                  !!sizeGroupError ||
                  !!quantityError ||
                  !editSizeGroup ||
                  !editQuantity ||
                  variantsLoading
                }
                className={`flex-1 py-3 px-4 rounded-xl font-medium transition-colors ${
                  sizeGroupError ||
                  quantityError ||
                  !editSizeGroup ||
                  !editQuantity ||
                  variantsLoading
                    ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                    : "bg-primary text-white hover:bg-primary/90"
                }`}
              >
                Save
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default OrderItemEditModal;
