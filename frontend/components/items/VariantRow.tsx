"use client";

import { Printer } from "lucide-react";
import { ImagePreview } from "@/components/pages/ImagePreview";
import { ItemVariantQR, SIZE_RANGE_TO_SIZES } from "@/types/item";
import StockBadge from "./StockBadge";

interface VariantRowProps {
    variant: ItemVariantQR;
    index: number;
    onPrintQR?: (qr: string) => void;
}

function deriveSizeGroups(variant: ItemVariantQR): string[] {
    const sizes = variant.sizes?.map((s) => s.size_range) || [];
    const sizeSet = new Set(sizes);

    const groups: string[] = [];

    const sizeRangeToSizes = SIZE_RANGE_TO_SIZES as Record<string, string[]>;

    for (const [group, groupSizes] of Object.entries(sizeRangeToSizes)) {
        const groupSizeSet = new Set(groupSizes);

        if (
            groupSizeSet.size === sizeSet.size &&
            [...groupSizeSet].every((s) => sizeSet.has(s))
        ) {
            groups.push(group);
        }
    }

    return groups.length > 0 ? groups : [];
}

export default function VariantRow({
    variant,
    index,
    onPrintQR,
}: VariantRowProps) {
    const sizeGroups = deriveSizeGroups(variant);

    return (
        <div className="flex items-center gap-3 bg-gray-50/70 border border-gray-100 p-3 rounded-xl">
            <div className="relative w-12 h-12 rounded-lg bg-white overflow-hidden flex-shrink-0 border border-gray-200 shadow-sm">
                {variant.image ? (
                    <ImagePreview
                        src={variant.image}
                        alt={`Variant ${index + 1}`}
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        <Printer className="size-4 text-gray-300" />
                    </div>
                )}
            </div>

            <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-700 truncate">
                    Variant #{index + 1}
                </p>
                <p className="text-xs text-gray-400">
                    QR: {variant.qr_code?.slice(0, 8) || "N/A"}...
                </p>
            </div>

            <StockBadge total={variant.total_stock} sizeGroups={sizeGroups} />

            <button
                type="button"
                onClick={() => {
                    if (variant.qr_code && onPrintQR) {
                        onPrintQR(variant.qr_code);
                    }
                }}
                disabled={!variant.qr_code}
                className="p-2.5 bg-primary text-white hover:bg-primary/90 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                title="Print QR"
            >
                <Printer className="size-4" />
            </button>
        </div>
    );
}
