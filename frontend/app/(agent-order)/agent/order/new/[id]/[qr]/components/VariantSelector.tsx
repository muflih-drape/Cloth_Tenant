"use client";

import { Check } from "lucide-react";
import { ImagePreview } from "@/components/pages/ImagePreview";
import type { ItemVariant } from "@/types/item";

interface VariantItem {
  variant_id: number;
  size_group: string;
  quantity: number;
}

interface VariantSelectorProps {
  variants: ItemVariant[];
  selectedVariant: ItemVariant | null;
  existingOrderItems: VariantItem[];
  selectedSizeGroup: string | null;
  onSelect: (variant: ItemVariant) => void;
}

export default function VariantSelector({
  variants,
  selectedVariant,
  existingOrderItems,
  selectedSizeGroup,
  onSelect,
}: VariantSelectorProps) {
  const handleSelect = (variant: ItemVariant) => {
    const existingForThisVariant = existingOrderItems.find(
      (item) => item.variant_id === variant.id,
    );

    if (
      existingForThisVariant &&
      selectedSizeGroup === existingForThisVariant.size_group &&
      selectedSizeGroup !== null
    ) {
      onSelect(variant);
    } else {
      onSelect(variant);
    }
  };

  return (
    <div className="mb-8">
      <div className="flex p-2 gap-4 overflow-x-auto pb-2 scrollbar-none">
        {variants.map((v, index) => {
          const existingForThisVariant = existingOrderItems.find(
            (item) => item.variant_id === v.id,
          );
          return (
            <button
              key={index}
              onClick={() => handleSelect(v)}
              className={`relative flex-shrink-0 w-20 h-20 rounded-3xl border-2 transition-all overflow-hidden ${
                selectedVariant?.id === v.id
                  ? "border border-primary scale-105"
                  : "border hover:border-gray-200"
              }`}
            >
              {v.image ? (
                <ImagePreview
                  src={v.image}
                  alt={`Variant ${index + 1}`}
                  enlargeDisabled={true}
                />
              ) : (
                <div className="w-full h-full bg-gray-100" />
              )}
              {existingForThisVariant && (
                <div className="absolute bottom-1 right-1 bg-primary text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                  {existingForThisVariant.quantity}
                </div>
              )}
              {selectedVariant?.id === v.id && (
                <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                  <Check className="text-white" size={24} strokeWidth={4} />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
