"use client";

import { QrCode } from "lucide-react";
import { ImagePreview } from "@/components/pages/ImagePreview";
import { ItemType, UIVariant } from "@/types/item";
import { variantColorLabel } from "@/lib/colorLabel";
import SizeRangeRow from "./SizeRangeRow";
import {
    getSizeRangesWithStock,
    isVariantOutOfStock,
} from "@/util/stockValidators";

interface VariantCardProps {
    variant: UIVariant;
    index: number;
    context: "admin" | "agent";
    isCompact?: boolean;
    onPrintQR?: (qr: string, id: number) => void;
    onOrder?: (variantId: number) => void;
    itemType: ItemType;
    isReadonly?: boolean;
}
export default function VariantCard({
    variant,
    index,
    context,
    onPrintQR,
    onOrder,
    itemType,
    isReadonly = false,
}: VariantCardProps) {
    const isOutOfStock = isVariantOutOfStock(variant, itemType);
    const sizeRanges = getSizeRangesWithStock(variant, itemType);
    const qrCode = "qr_code" in variant ? variant.qr_code : null;

    return (
        <div
            className={`rounded-lg border p-3 ${isOutOfStock && !isReadonly
                    ? "bg-red-100 border border-red-200"
                    : "bg-white border-gray-100"
                }`}
        >
            <div className="flex items-center gap-2 mb-2">
                <div className="relative w-8 h-8 rounded bg-gray-200 overflow-hidden flex-shrink-0">
                    {variant.image ? (
                        <ImagePreview
                            src={variant.image}
                            alt={`Variant ${index + 1}`}
                        />
                    ) : (
                        <div className="w-full h-full" />
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-700 truncate">
                        {variantColorLabel(variant.display_order, index + 1)}
                    </p>
                    {qrCode && (
                        <p className="text-[10px] text-gray-400 truncate">
                            {qrCode.slice(0, 10)}...
                        </p>
                    )}
                </div>
            </div>

            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                {sizeRanges.map(({ sizeRange, stock }) => (
                    <SizeRangeRow
                        key={sizeRange}
                        sizeRange={sizeRange}
                        stock={stock}
                        isDisabled={isOutOfStock}
                        isReadonly={isReadonly}
                    />
                ))}
            </div>

            <div className="flex items-center justify-end gap-2 mt-2">
                {context === "admin" && qrCode && !isReadonly && (
                    <button
                        onClick={() => onPrintQR?.(qrCode, variant.id)}
                        className="p-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg transition-colors"
                    >
                        <QrCode size={12} />
                    </button>
                )}
                {context === "agent" && (
                    <button
                        onClick={() => onOrder?.(variant.id)}
                        disabled={isOutOfStock}
                        className={`px-3 py-1 rounded-md text-xs font-bold transition-colors ${isOutOfStock && !isReadonly
                                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                                : "bg-primary text-white hover:bg-primary/90"
                            }`}
                    >
                        Order
                    </button>
                )}
            </div>
        </div>
    );
}
