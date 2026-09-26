"use client";

import { ChevronDown, ChevronUp, Info, Edit, QrCode } from "lucide-react";
import { ImagePreview } from "@/components/pages/ImagePreview";
import { ItemType, UIItem } from "@/types/item";
import { archiveCountdownLabel } from "@/util/archiveLabel";
import VariantCard from "./VariantCard";
import { isItemOutOfStock, isVariantOutOfStock } from "@/util/stockValidators";
import { compareByVariantOrder } from "@/lib/sortVariants";

interface ItemCardProps {
    item: UIItem;
    context: "admin" | "agent";
    isExpanded: boolean;
    onToggle: () => void;
    onEdit?: (id: number) => void;
    onPrintAll?: (id: number) => void;
    onPrintQR?: (qr: string, id: number) => void;
    onOrder?: (variantId: number) => void;
    isReadonly?: boolean;
    countdownDays?: number | null;
}

function getItemImage(item: UIItem): string | null {
    return item.variants[0]?.image || null;
}

function hasOutOfStockVariants(item: UIItem): boolean {
    return item.variants.some((variant) =>
        isVariantOutOfStock(variant, item.type),
    );
}

export default function ItemCard({
    item,
    context,
    isExpanded,
    onToggle,
    onEdit,
    onPrintAll,
    onPrintQR,
    onOrder,
    isReadonly = false,
    countdownDays,
}: ItemCardProps) {
    const hasPartialOutOfStock = hasOutOfStockVariants(item);
    const image = getItemImage(item);
    const price = item.price;

    const itemStockOut = isItemOutOfStock(item);

    return (
        <div
            className={`rounded-md overflow-hidden transition-all border-gray-300 ${
                itemStockOut
                    ? "bg-red-50 border border-red-200"
                    : isExpanded
                      ? "bg-gray-50 border"
                      : "bg-white border"
            }`}
        >
            <div
                className={`flex items-center gap-3 p-2 cursor-pointer transition-colors ${
                    isExpanded ? "" : "hover:bg-gray-50/50"
                }`}
                onClick={onToggle}
            >
                <div className="relative w-14 h-14 rounded-md bg-gray-50 overflow-hidden flex-shrink-0 border border-gray-100">
                    {image ? (
                        <ImagePreview src={image} alt={item.name} />
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
                        {countdownDays != null && countdownDays >= 0 && (
                            <span
                                className={`text-[9px] px-1.5 py-0.5 rounded-md uppercase font-bold tracking-tighter border flex-shrink-0 ${
                                    countdownDays <= 7
                                        ? "bg-amber-100 text-amber-700 border-amber-200"
                                        : "bg-gray-100 text-gray-500 border-gray-200"
                                }`}
                            >
                                {archiveCountdownLabel(countdownDays)}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-400">
                            {item.variants.length} variant
                            {item.variants.length !== 1 ? "s" : ""}
                        </span>
                        {price && context === "agent" && (
                            <>
                                <span className="text-gray-200">•</span>
                                <span className="text-xs font-bold text-primary">
                                    ₹{Number(price).toLocaleString("en-IN")}
                                </span>
                            </>
                        )}
                        {/*{hasPartialOutOfStock && (
                            <>
                                <span className="text-gray-200">•</span>
                                <span className="text-xs text-red-500 font-medium">
                                    {itemStockOut ? "All out" : "Some out"}
                                </span>
                            </>
                        )}*/}
                    </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                    {context === "admin" && !isReadonly && (
                        <>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onEdit?.(item.id);
                                }}
                                className="p-2 bg-gray-100 text-gray-500 hover:bg-black hover:text-white hover:cursor-pointer rounded-md transition-colors"
                                title="Edit Item"
                            >
                                <Edit size={14} />
                            </button>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onPrintAll?.(item.id);
                                }}
                                className="p-2 bg-gray-100 text-gray-500 hover:bg-black hover:text-white hover:cursor-pointer rounded-md transition-colors"
                                title="Print All QR"
                            >
                                <QrCode size={14} />
                            </button>
                        </>
                    )}
                    <div
                        className={`p-1 rounded-xl transition-colors text-gray-500`}
                    >
                        {isExpanded ? (
                            <ChevronUp size={14} />
                        ) : (
                            <ChevronDown size={14} />
                        )}
                    </div>
                </div>
            </div>

            {isExpanded && (
                <div className="px-4 pb-4 pt-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {[...item.variants]
                            .sort(compareByVariantOrder)
                            .map((variant, index) => (
                            <VariantCard
                                key={variant.id}
                                variant={variant}
                                index={index}
                                context={context}
                                itemType={item.type as ItemType}
                                onPrintQR={
                                    context === "admin" ? onPrintQR : undefined
                                }
                                onOrder={
                                    context === "agent" ? onOrder : undefined
                                }
                                isReadonly={isReadonly}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
