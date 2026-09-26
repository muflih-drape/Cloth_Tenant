"use client";

import { ArrowLeft, Plus } from "lucide-react";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import ColorCard from "./colorCard";
import CommonDetailsBadge from "./commonDetailsBadge";
import type { ColorVariant, CommonDetails } from "@/types/item";

interface Props {
  common: CommonDetails;
  variants: ColorVariant[];
  loading: boolean;
  onEditCommon: () => void;
  onAddColor: () => void;
  onEditColor: (id: string) => void;
  onDeleteColor: (id: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}

export default function ColorListScreen({
  common,
  variants,
  loading,
  onEditCommon,
  onAddColor,
  onEditColor,
  onDeleteColor,
  onSubmit,
  onBack,
}: Props) {
  return (
    <div className="flex flex-col min-h-screen bg-white px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={onBack}
          className="p-2 -ml-2 rounded-full hover:bg-gray-50"
        >
          <ArrowLeft size={24} />
        </button>
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-widest">
            Step 2 of 2
          </p>
          <h1 className="text-xl font-black leading-tight">Colors</h1>
        </div>
      </div>

      {/* Common details — read-only with edit shortcut */}
      <CommonDetailsBadge common={common} onEdit={onEditCommon} />

      {/* Color list */}
      <div className="mt-6 space-y-3 flex-1">
        {variants.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
              <Plus size={22} className="text-gray-300" />
            </div>
            <p className="text-sm text-gray-400">No colors added yet</p>
            <p className="text-xs text-gray-300">
              Tap the button below to add your first color variant
            </p>
          </div>
        )}

        {variants.map((v, i) => (
          <ColorCard
            key={v.id}
            variant={v}
            index={i}
            isOnly={variants.length === 1}
            onEdit={() => onEditColor(v.id)}
            onDelete={() => onDeleteColor(v.id)}
          />
        ))}

        {/* Add color button */}
        <button
          type="button"
          onClick={onAddColor}
          className="w-full flex items-center justify-center gap-2 h-12 rounded-2xl border-2 border-dashed border-gray-200 text-sm font-semibold text-gray-400 hover:border-primary hover:text-primary hover:bg-primary/5 transition-all active:scale-[0.98]"
        >
          <Plus size={16} />
          Add New Color
        </button>
      </div>

      {/* Submit */}
      <div className="mt-auto pt-8 pb-6">
        <StockFlowButton
          variant="filled"
          text={loading ? "Creating…" : "Create Item"}
          disabled={variants.length === 0 || loading}
          onClick={onSubmit}
          className="w-full h-14 rounded-2xl bg-primary text-white font-bold shadow-lg shadow-primary/20 flex items-center justify-center"
        />
      </div>
    </div>
  );
}
