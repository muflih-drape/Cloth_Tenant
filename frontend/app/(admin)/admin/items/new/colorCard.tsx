"use client";

import { ImagePlus, Pencil, Trash2 } from "lucide-react";
import type { ColorVariant } from "@/types/item";
import { ImagePreview } from "@/components/pages/ImagePreview";

interface Props {
  variant: ColorVariant;
  index: number; // 1-based
  onEdit: () => void;
  onDelete: () => void;
  isOnly: boolean;
}

export default function ColorCard({
  variant,
  index,
  onEdit,
  onDelete,
  isOnly,
}: Props) {
  const sizeList = variant.sizeRange;

  return (
    <div className="flex items-center gap-3 bg-white border border-gray-100 rounded-2xl px-4 py-3 shadow-sm">
      {/* Thumbnail */}
      <div className="flex-shrink-0 w-14 h-14 rounded-xl overflow-hidden bg-gray-100 flex items-center justify-center">
        {variant.imagePreview ? (
          <ImagePreview src={variant.imagePreview} alt={`Variant ${index}`} />
        ) : (
          <ImagePlus size={18} className="text-gray-300" />
        )}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">Variant #{index + 1}</p>
        {Object.keys(variant.perSizeStock!).length > 0 ? (
          // Kids: show selected sizes and their individual stock
          <p className="text-[11px] text-gray-400 mt-0.5 truncate">
            {Object.entries(variant.perSizeStock!)
              .map(([size, stock]) => `${size}: ${stock} pcs`)
              .join(" | ")}
          </p>
        ) : (
          // Gents: show size range + uniform stock
          <>
            <p className="text-[11px] text-gray-400 mt-0.5 truncate">
              {variant.sizeRange}
            </p>
            <p className="text-[11px] text-gray-400">
              {variant.stock} per size
            </p>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={onEdit}
          className="p-2 rounded-full text-gray-400 active:bg-gray-100"
          aria-label="Edit"
        >
          <Pencil size={16} />
        </button>
        {!isOnly && (
          <button
            type="button"
            onClick={onDelete}
            className="p-2 rounded-full text-red-400 active:bg-red-50"
            aria-label="Delete"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
