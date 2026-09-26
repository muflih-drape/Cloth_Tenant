"use client";

import { ImagePlus, Pencil, Trash2 } from "lucide-react";
import type { ColorVariant } from "@/types/item";
import { formatMeters } from "@/types/item";
import { ImagePreview } from "@/components/pages/ImagePreview";

interface Props {
  variant: ColorVariant;
  index: number; // 0-based
  onEdit: () => void;
  onDelete: () => void;
  isOnly: boolean;
}

export default function ColorCard({ variant, index, onEdit, onDelete, isOnly }: Props) {
  return (
    <div className="flex items-center gap-3 bg-white border border-gray-100 rounded-2xl px-4 py-3 shadow-sm">
      <div className="flex-shrink-0 w-14 h-14 rounded-xl overflow-hidden bg-gray-100 flex items-center justify-center">
        {variant.imagePreview ? (
          <ImagePreview src={variant.imagePreview} alt={`Colour ${index + 1}`} />
        ) : (
          <ImagePlus size={18} className="text-gray-300" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm truncate">
          {variant.displayOrder || `Colour #${index + 1}`}
        </p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          {formatMeters(variant.stockMeters)} m in stock
        </p>
      </div>

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
