"use client";

import { Check } from "lucide-react";
import { ImagePreview } from "@/components/pages/ImagePreview";
import type { FabricVariant } from "@/types/item";
import { formatMeters, toMeters } from "@/types/item";

interface VariantSelectorProps {
  variants: FabricVariant[];
  selectedVariant: FabricVariant | null;
  /** Metres already on the order for this colour, so it can be badged. */
  existingMetresByVariant: Record<number, number>;
  onSelect: (variant: FabricVariant) => void;
}

export default function VariantSelector({
  variants,
  selectedVariant,
  existingMetresByVariant,
  onSelect,
}: VariantSelectorProps) {
  if (variants.length === 0) return null;

  return (
    <div className="mb-8">
      <h3 className="font-bold text-gray-900 mb-3">Colour</h3>
      <div className="flex p-2 gap-4 overflow-x-auto pb-2 scrollbar-none">
        {variants.map((v, index) => {
          const alreadyOn = toMeters(existingMetresByVariant[v.id] ?? 0);
          const isSelected = selectedVariant?.id === v.id;
          return (
            <div key={v.id} className="flex flex-col items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => onSelect(v)}
                className={`relative w-20 h-20 rounded-3xl border-2 transition-all overflow-hidden ${
                  isSelected
                    ? "border-primary scale-105"
                    : "border hover:border-gray-200"
                }`}
                aria-label={v.display_order || `Colour ${index + 1}`}
              >
                {v.image ? (
                  <ImagePreview
                    src={v.image}
                    alt={v.display_order || `Colour ${index + 1}`}
                    enlargeDisabled={true}
                  />
                ) : (
                  <div className="w-full h-full bg-gray-100" />
                )}
                {alreadyOn > 0 && (
                  <div className="absolute bottom-1 right-1 bg-primary text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                    {formatMeters(alreadyOn)} m
                  </div>
                )}
                {isSelected && (
                  <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                    <Check className="text-white" size={24} strokeWidth={4} />
                  </div>
                )}
              </button>
              <span className="text-[10px] font-bold text-gray-500 max-w-20 truncate">
                {v.display_order || `Colour ${index + 1}`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
