"use client";

import { Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { EditableVariant } from "@/types/item";

interface Props {
  variant: EditableVariant;
  /** @deprecated Not used but kept for API compatibility */
  _index?: number;
  isOnly: boolean;
  onChange: (updated: EditableVariant) => void;
  onDelete: () => void;
}

interface DisplayOrderFieldProps {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}

/**
 * Display-order input for one variant. Kept as a small fixed-width field: the
 * value may be an empty string (nullable display_order), and without an
 * explicit width it would otherwise stretch across the whole row as a long
 * blank bar.
 */
export function DisplayOrderField({
  value,
  placeholder = "0",
  onChange,
}: DisplayOrderFieldProps) {
  return (
    <Input
      type="number"
      min={0}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-24 shrink-0 text-sm"
    />
  );
}

export default function EditVariantRow({
  variant,
  isOnly,
  onChange,
  onDelete,
}: Props) {
  const set = <K extends keyof EditableVariant>(
    key: K,
    val: EditableVariant[K],
  ) => onChange({ ...variant, [key]: val });

  return (
    <div className="flex items-center gap-3 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
      {/* Size chip */}
      <div className="flex-shrink-0 w-14 text-center">
        <span className="inline-block bg-gray-100 text-gray-600 text-xs font-bold rounded-lg px-2 py-1">
          {variant.size}
        </span>
      </div>

      {/* Stock */}
      <div className="flex-1 flex items-center gap-2">
        <span className="text-xs text-gray-400 flex-shrink-0">Stock</span>
        <Input
          type="number"
          min={0}
          value={variant.stock === 0 ? "" : variant.stock}
          placeholder="0"
          onChange={(e) => set("stock", parseInt(e.target.value, 10) || 0)}
          onFocus={(e) => e.target.select()}
          className="h-8 text-sm"
        />
      </div>

      {/* Delete row */}
      {/*{!isOnly && (
                <button
                    type="button"
                    onClick={onDelete}
                    className="flex-shrink-0 p-2 rounded-md text-red-500 hover:text-white hover:bg-red-500 transition-colors"
                    aria-label="Delete size"
                >
                    <Trash2 size={15} />
                </button>
            )}*/}
    </div>
  );
}
