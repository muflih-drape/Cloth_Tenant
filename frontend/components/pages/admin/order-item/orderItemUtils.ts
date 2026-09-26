import {
    SIZE_RANGE_TO_SIZES,
    SIZE_RANGE_PIECE_COUNT,
    FrontendSizeRange,
    getSizesForItemType,
    VariantSize,
    ItemType,
} from "@/types/item";

export function getAvailableStockForSizeGroup(
    variantSizes: VariantSize[],
    sizeGroup: string,
    reservedItems: Array<{ size_group: string; quantity: number }>,
): number {
    const selectedSizes =
        SIZE_RANGE_TO_SIZES[sizeGroup as FrontendSizeRange] || [];
    if (selectedSizes.length === 0) return 0;

    const remainingStocks = selectedSizes.map((selectedSize) => {
        const baseStock =
            variantSizes.find((s) => s.size_range === selectedSize)?.stock || 0;

        const reservedForThisSize = reservedItems.reduce((sum, item) => {
            const itemSizes =
                SIZE_RANGE_TO_SIZES[item.size_group as FrontendSizeRange] || [];
            if (itemSizes.includes(selectedSize)) {
                return sum + item.quantity;
            }
            return sum;
        }, 0);

        return baseStock - reservedForThisSize;
    });

    return Math.max(0, Math.min(...remainingStocks));
}

export function getPiecesForGroup(sizeGroup: string): number {
    return SIZE_RANGE_PIECE_COUNT[sizeGroup] || 0;
}

export function getAvailableSizeGroups(
    variantSizes: VariantSize[],
    itemType: ItemType,
): string[] {
    const variantSizeSet = new Set(variantSizes.map((s) => s.size_range));
    return getSizesForItemType(itemType, "order_creation").filter((range) => {
        const requiredSizes = SIZE_RANGE_TO_SIZES[range];
        return requiredSizes.every((s) => variantSizeSet.has(s));
    });
}
