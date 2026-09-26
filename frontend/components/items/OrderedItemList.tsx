"use client";

import { useMemo } from "react";
import { Info, ChevronRight } from "lucide-react";
import { ImagePreview } from "@/components/pages/ImagePreview";
import { UnpackedOrderItem } from "@/lib/api/order";

interface OrderedItemGroup {
  name: string;
  type: string;
  variantOrders: string[];
  variantImage: string;
  sizeGroup: string;
  totalQuantity: number;
  pieceCount: number;
}

interface OrderedItemListProps {
  items: UnpackedOrderItem[];
  onItemClick: (itemId: number) => void;
}

export default function OrderedItemList({
  items,
  onItemClick,
}: OrderedItemListProps) {
  const grouped = useMemo(() => {
    const map = new Map<string, OrderedItemGroup>();
    for (const item of items) {
      const existing = map.get(item.item_name);
      if (existing) {
        if (
          item.variant_display_order &&
          !existing.variantOrders.includes(item.variant_display_order)
        ) {
          existing.variantOrders.push(item.variant_display_order);
        }
        existing.totalQuantity += item.quantity;
      } else {
        map.set(item.item_name, {
          name: item.item_name,
          type: item.item_type,
          variantOrders: item.variant_display_order
            ? [item.variant_display_order]
            : [],
          variantImage: item.variant_image,
          sizeGroup: item.size_group,
          totalQuantity: item.quantity,
          pieceCount: item.piece_count,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      b.name.localeCompare(a.name, undefined, { numeric: true }),
    );
  }, [items]);

  if (grouped.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-300">
        <Info size={48} className="mb-4" />
        <h2 className="text-lg font-bold text-gray-400">No ordered items</h2>
        <p className="text-sm text-gray-400 mt-1">No unpacked items found</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {grouped.map((item) => {
        const sortedVariants = [...item.variantOrders].sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true }),
        );

        return (
          <button
            key={item.name}
            onClick={() => onItemClick(items.find((i) => i.item_name === item.name)?.id ?? 0)}
            className="w-full flex items-center gap-3 p-2 rounded-md border border-gray-300 bg-white hover:bg-gray-50/50 transition-colors text-left cursor-pointer"
          >
            <div className="relative w-14 h-14 rounded-md bg-gray-50 overflow-hidden flex-shrink-0 border border-gray-100">
              {item.variantImage ? (
                <ImagePreview
                  src={item.variantImage}
                  alt={item.name}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Info size={20} className="text-gray-300" />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h6 className="font-bold text-gray-900 text-sm truncate leading-tight">
                  {item.name}
                </h6>
                {item.type && (
                  <span className="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-md uppercase font-bold tracking-tighter border border-gray-200 flex-shrink-0">
                    {item.type}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {sortedVariants.length > 0 && (
                  <span className="text-[12px] text-gray-900">
                    Color #{sortedVariants.join(", #")}
                  </span>
                )}
                {item.sizeGroup && (
                  <>
                    <span className="text-gray-200">·</span>
                    <span className="text-[12px] text-gray-900">
                      Size: {item.sizeGroup}
                    </span>
                  </>
                )}
                <span className="text-gray-200">·</span>
                <span className="text-[12px] text-gray-900">
                  {item.totalQuantity} × {item.pieceCount} pcs
                </span>
              </div>
            </div>

            <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
          </button>
        );
      })}
    </div>
  );
}
