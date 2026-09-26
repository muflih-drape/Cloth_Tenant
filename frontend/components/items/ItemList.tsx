"use client";

import { useState, useMemo, useCallback } from "react"; // ✅ added useCallback
import { Plus, ShoppingBag, Search, QrCode, X } from "lucide-react";
import { UIItem } from "@/types/item";
import { UnpackedOrderItem } from "@/lib/api/order";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import ItemCard from "./ItemCard";
import OrderedItemList from "./OrderedItemList";
import QRScanModal from "./QRScanModal";
import {
    isItemOutOfStock,
    isItemPartiallyOutOfStock,
    isVariantOutOfStock,
} from "@/util/stockValidators";
import { PageLoading } from "../ui/Loading";

export type StockTab = "in_stock" | "out_of_stock" | "ordered";

interface ItemListProps {
    items: UIItem[];
    loading: boolean;
    context: "admin" | "agent";
    initialTab?: StockTab;
    onAddItem?: () => void;
    onEdit?: (id: number) => void;
    onPrintAll?: (id: number) => void;
    onPrintQR?: (qr: string, id: number) => void;
    onOrder?: (variantId: number) => void;
    onPriceCheck?: () => void;
    title?: string;
    orderedItems?: UnpackedOrderItem[];
    onOrderItemClick?: (itemId: number) => void;
}

function filterItems(
    items: UIItem[],
    tab: StockTab,
    searchQuery: string,
    qrFilter: string | null,
): UIItem[] {
    let filtered = [...items];

    if (tab === "in_stock") {
        filtered = filtered.filter((item) => !isItemOutOfStock(item));
        filtered = filtered.map((item) => ({
            ...item,
            variants: item.variants.filter(
                (v) => !isVariantOutOfStock(v, item.type),
            ),
        }));
    } else if (tab === "out_of_stock") {
        filtered = filtered.filter(
            (item) =>
                isItemOutOfStock(item) ||
                item.variants.some((v) => isVariantOutOfStock(v, item.type)),
        );
        filtered = filtered.map((item) => ({
            ...item,
            variants: item.variants.filter((v) =>
                isVariantOutOfStock(v, item.type),
            ),
        }));
    }

    if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        filtered = filtered.filter((item) =>
            item.name.toLowerCase().includes(query),
        );
    }

    if (qrFilter) {
        const qr = qrFilter.toLowerCase();
        filtered = filtered.filter((item) =>
            item.variants.some((v) => v.qr_code?.toLowerCase().includes(qr)),
        );
    }

    return filtered;
}

export default function ItemList({
    items,
    loading,
    context,
    initialTab = "in_stock",
    onAddItem,
    onEdit,
    onPrintAll,
    onPrintQR,
    onOrder,
    onPriceCheck,
    title,
    orderedItems = [],
    onOrderItemClick,
}: ItemListProps) {
    const [activeTab, setActiveTab] = useState<StockTab>(initialTab);
    const [searchQuery, setSearchQuery] = useState("");
    const [qrFilter, setQrFilter] = useState<string | null>(null);
    const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
    const [showQRScanner, setShowQRScanner] = useState(false);
    const [visibleCount, setVisibleCount] = useState(40);

    // ✅ memoized
    const toggleExpanded = useCallback((itemId: number) => {
        setExpandedItems((prev) => {
            const next = new Set(prev);
            if (next.has(itemId)) {
                next.delete(itemId);
            } else {
                next.add(itemId);
            }
            return next;
        });
    }, []);

    // ✅ memoized
    const handleQRScan = useCallback((qr: string) => {
        setQrFilter(qr);
        setShowQRScanner(false);
    }, []);

    // ✅ memoized
    const clearFilters = useCallback(() => {
        setSearchQuery("");
        setQrFilter(null);
    }, []);

    // ✅ memoized
    const handleCloseScanner = useCallback(() => {
        setShowQRScanner(false);
    }, []);

    // ✅ memoized
    const handleShowScanner = useCallback(() => {
        setShowQRScanner(true);
    }, []);

    // ✅ memoized
    const handleShowMore = useCallback(() => {
        setVisibleCount((prev) => prev + 40);
    }, []);

    const filteredItems = useMemo(() => {
        return filterItems(items ?? [], activeTab, searchQuery, qrFilter);
    }, [items, activeTab, searchQuery, qrFilter]);

    const filteredOrderedItems = useMemo(() => {
        if (!searchQuery.trim()) return orderedItems;
        const query = searchQuery.toLowerCase();
        return orderedItems.filter((item) =>
            item.item_name.toLowerCase().includes(query),
        );
    }, [orderedItems, searchQuery]);

    const visibleItems = filteredItems.slice(0, visibleCount);

    const inStockCount = useMemo(
        () => items.filter((item) => !isItemOutOfStock(item)).length,
        [items],
    );
    const outOfStockCount = useMemo(
        () =>
            items.filter(
                (item) =>
                    isItemOutOfStock(item) || isItemPartiallyOutOfStock(item),
            ).length,
        [items],
    );

    const headerTitle =
        title || (context === "admin" ? "Inventory" : "My Items");
    const headerSubtitle =
        context === "admin" ? "Total Items" : "Available to Order";

    const hasActiveFilters = searchQuery || qrFilter;

    if (loading) {
        return <PageLoading />;
    }

    console.log("Item :", items);

    return (
        <div>
            <QRScanModal
                isOpen={showQRScanner}
                onClose={handleCloseScanner}
                onScan={handleQRScan}
            />

            <div className="pt-6 pb-4 px-4">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col w-full">
                        <h1 className="text-xl font-extrabold text-gray-900">
                            {headerTitle}
                        </h1>
                        <div className="flex w-full justify-between">
                            <div className="flex gap-2 items-center mt-1">
                                <span className="text-gray-400 text-sm font-medium">
                                    {headerSubtitle}
                                </span>
                                <div className="bg-primary/10 text-primary rounded-full py-0.5 px-3 border border-primary/20">
                                    <span className="font-bold text-xs">
                                        {context === "admin"
                                            ? items.length
                                            : inStockCount}
                                    </span>
                                </div>
                            </div>

                            {context === "agent" && onPriceCheck && (
                                <button
                                    onClick={onPriceCheck}
                                    className="flex items-center gap-1.5 px-2.5 py-1 bg-black hover:bg-black/80 rounded-md transition-colors"
                                >
                                    <QrCode size={20} className="text-white" />
                                    <span className="text-[12px] font-bold text-white">
                                        Check Price
                                    </span>
                                </button>
                            )}
                        </div>
                    </div>
                    {context === "admin" && onAddItem && (
                        <StockFlowButton
                            text="Add"
                            icon={<Plus className="size-4" />}
                            onClick={onAddItem}
                            className="shadow-lg shadow-primary/20"
                        />
                    )}
                </div>
            </div>

            <div className="px-4 pb-4 space-y-3">
                <div className="relative flex items-center gap-2">
                    <div className="relative flex-1">
                        <Search
                            size={16}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                        />
                        <input
                            type="text"
                            placeholder={
                                activeTab === "ordered"
                                    ? "Search ordered items..."
                                    : "Search items..."
                            }
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-3 py-2.5 bg-white border border-gray-200 rounded-xl font-medium text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                        />
                    </div>
                    <button
                        onClick={handleShowScanner}
                        className="p-2.5 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
                    >
                        <QrCode size={18} className="text-gray-500" />
                    </button>
                </div>

                {hasActiveFilters && (
                    <div className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-xl px-3 py-2">
                        <span className="text-xs text-primary font-medium">
                            {qrFilter && `QR: ${qrFilter.slice(0, 12)}...`}
                            {qrFilter && searchQuery && " • "}
                            {searchQuery && `Name: ${searchQuery}`}
                        </span>
                        <button
                            onClick={clearFilters}
                            className="p-1 hover:bg-primary/10 rounded-lg transition-colors"
                        >
                            <X size={14} className="text-primary" />
                        </button>
                    </div>
                )}

                <div className="flex gap-2 p-1 bg-gray-100 rounded-xl">
                    <button
                        onClick={() => setActiveTab("in_stock")}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                            activeTab === "in_stock"
                                ? "bg-white text-gray-900 shadow-sm"
                                : "text-gray-500 hover:text-gray-700"
                        }`}
                    >
                        Stock In ({inStockCount})
                    </button>
                    <button
                        onClick={() => setActiveTab("out_of_stock")}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                            activeTab === "out_of_stock"
                                ? "bg-white text-gray-900 shadow-sm"
                                : "text-gray-500 hover:text-gray-700"
                        }`}
                    >
                        Stock Out ({outOfStockCount})
                    </button>
                    {context === "admin" && (
                        <button
                            onClick={() => setActiveTab("ordered")}
                            className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                                activeTab === "ordered"
                                    ? "bg-white text-gray-900 shadow-sm"
                                    : "text-gray-500 hover:text-gray-700"
                            }`}
                        >
                            Ordered ({searchQuery.trim() ? filteredOrderedItems.length : orderedItems.length})
                        </button>
                    )}
                </div>
            </div>
            <div className="px-4 pb-8 space-y-2">
                {activeTab === "ordered" ? (
                    filteredOrderedItems.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-gray-300">
                            <ShoppingBag size={48} className="mb-4" />
                            <h2 className="text-lg font-bold text-gray-400">
                                No items found
                            </h2>
                            <p className="text-sm text-gray-400 mt-1">
                                {searchQuery.trim()
                                    ? "Try a different search"
                                    : "No unpacked items found"}
                            </p>
                            {searchQuery.trim() && (
                                <button
                                    onClick={() => setSearchQuery("")}
                                    className="mt-3 text-primary text-sm font-medium hover:underline"
                                >
                                    Clear search
                                </button>
                            )}
                        </div>
                    ) : (
                        <OrderedItemList
                            items={filteredOrderedItems}
                            onItemClick={onOrderItemClick || (() => {})}
                        />
                    )
                ) : filteredItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-gray-300">
                        <ShoppingBag size={48} className="mb-4" />
                        <h2 className="text-lg font-bold text-gray-400">
                            No items found
                        </h2>
                        <p className="text-sm text-gray-400 mt-1">
                            {hasActiveFilters
                                ? "Try a different search"
                                : "No items in this category"}
                        </p>
                        {hasActiveFilters && (
                            <button
                                onClick={clearFilters}
                                className="mt-3 text-primary text-sm font-medium hover:underline"
                            >
                                Clear filters
                            </button>
                        )}
                    </div>
                ) : (
                    <>
                        {visibleItems.map((item) => (
                            <ItemCard
                                key={item.id}
                                item={item}
                                context={context}
                                isExpanded={expandedItems.has(item.id)}
                                onToggle={() => toggleExpanded(item.id)}
                                onEdit={
                                    context === "admin" ? onEdit : undefined
                                }
                                onPrintAll={
                                    context === "admin" ? onPrintAll : undefined
                                }
                                onPrintQR={
                                    context === "admin" ? onPrintQR : undefined
                                }
                                onOrder={
                                    context === "agent" ? onOrder : undefined
                                }
                            />
                        ))}

                        {visibleCount < filteredItems.length && (
                            <button
                                onClick={handleShowMore}
                                className="w-full py-3 text-sm font-semibold text-primary border border-primary/20 rounded-xl bg-primary/5 hover:bg-primary/10 transition-colors"
                            >
                                Show More ({filteredItems.length - visibleCount}{" "}
                                remaining)
                            </button>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
