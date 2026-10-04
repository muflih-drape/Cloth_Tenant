"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, QrCode } from "lucide-react";
import { ImagePreview } from "@/components/pages/ImagePreview";
import { UIVariant } from "@/types/item";
import { variantColorLabel } from "@/lib/colorLabel";
import { primeRolls } from "@/lib/rollsCache";
import StockMetresRow from "./StockMetresRow";
import VariantRollsList from "./variantRollsList";
import { isVariantOutOfStock } from "@/util/stockValidators";

interface VariantCardProps {
    variant: UIVariant;
    index: number;
    context: "admin" | "agent";
    isCompact?: boolean;
    onPrintQR?: (qr: string, id: number) => void;
    onOrder?: (variantId: number) => void;
    isReadonly?: boolean;
}

export default function VariantCard({
    variant,
    index,
    context,
    onPrintQR,
    onOrder,
    isReadonly = false,
}: VariantCardProps) {
    const isOutOfStock = isVariantOutOfStock(variant);
    const qrCode = variant.qr_code;
    const colorLabel = variantColorLabel(variant.display_order, index + 1);
    /**
     * Whether this colour's physical rolls are showing.
     *
     * Held here, on the card, rather than in the list page: the list page already
     * keeps a set of which fabrics are open, and a second one for which colours
     * within them are would mean threading another prop through the fabric row for
     * state that only this card reads.
     */
    const [showRolls, setShowRolls] = useState(false);
    // Rolls are a warehouse view, and the labels are printed from the same place
    // the QR sheet is. An agent picking colours is not shown either.
    const canShowRolls = context === "admin" && !isReadonly;

    return (
        <div
            className={`rounded-lg border p-3 ${
                isOutOfStock && !isReadonly
                    ? "bg-red-100 border border-red-200"
                    : "bg-white border-gray-100"
            }`}
        >
            {/*
                The header is the toggle: the card was inert before, and the rolls
                are the only thing there is to open. The buttons below stay outside
                it so they keep doing exactly what they did.
            */}
            <button
                type="button"
                onClick={() => setShowRolls((v) => !v)}
                onMouseEnter={() => canShowRolls && primeRolls(variant.id)}
                onFocus={() => canShowRolls && primeRolls(variant.id)}
                disabled={!canShowRolls}
                aria-expanded={canShowRolls ? showRolls : undefined}
                className={`w-full text-left ${canShowRolls ? "cursor-pointer" : "cursor-default"}`}
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
                            {colorLabel}
                        </p>
                        {qrCode && (
                            <p className="text-[10px] text-gray-400 truncate">
                                {qrCode.slice(0, 10)}...
                            </p>
                        )}
                    </div>
                    {canShowRolls &&
                        (showRolls ? (
                            <ChevronUp size={14} className="text-gray-400 flex-shrink-0" />
                        ) : (
                            <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
                        ))}
                </div>
            </button>

            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                <StockMetresRow
                    stockMeters={variant.stock_meters}
                    isDisabled={isOutOfStock}
                    isReadonly={isReadonly}
                />
            </div>

            <div className="flex items-center justify-end gap-2 mt-2">
                {context === "admin" && qrCode && !isReadonly && (
                    <button
                        onClick={() => onPrintQR?.(qrCode, variant.id)}
                        className="p-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg transition-colors"
                        aria-label={`Print QR code for ${colorLabel}`}
                    >
                        <QrCode size={12} />
                    </button>
                )}
                {context === "agent" && (
                    <button
                        onClick={() => onOrder?.(variant.id)}
                        disabled={isOutOfStock}
                        className={`px-3 py-1 rounded-md text-xs font-bold transition-colors ${
                            isOutOfStock && !isReadonly
                                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                                : "bg-primary text-white hover:bg-primary/90"
                        }`}
                    >
                        Order
                    </button>
                )}
            </div>

            {showRolls && canShowRolls && (
                <VariantRollsList
                    variantId={variant.id}
                    label={colorLabel}
                />
            )}
        </div>
    );
}
