import {
    FrontendSizeRange,
    ItemType,
    ORDER_CREATION_SIZES_BY_TYPE,
    SIZE_RANGE_TO_SIZES,
    UIItem,
    UIVariant,
} from "@/types/item";

export function isItemOutOfStock(item: UIItem): boolean {
    return item.variants.every((variant) =>
        isVariantOutOfStock(variant, item.type),
    );
}

export function isItemPartiallyOutOfStock(item: UIItem): boolean {
    const outOfStockVariants = item.variants.filter((variant) =>
        isVariantOutOfStock(variant, item.type),
    );
    return (
        outOfStockVariants.length > 0 &&
        outOfStockVariants.length < item.variants.length
    );
}

export function getSizeRangesWithStock(
    variant: UIVariant,
    itemType: ItemType,
): { sizeRange: string; stock: number }[] {
    const sizes = variant.sizes;

    const result: { sizeRange: FrontendSizeRange; stock: number }[] = [];

    const sizeMap = Object.fromEntries(
        sizes.map((s) => [s.size_range, s.stock]),
    );
    const allowedRanges = ORDER_CREATION_SIZES_BY_TYPE[itemType];

    for (const range of allowedRanges) {
        const groupedSizes = SIZE_RANGE_TO_SIZES[range];

        const matched = groupedSizes.filter((s) => sizeMap[s] !== undefined);

        // ❌ skip if nothing matches
        if (matched.length === 0) continue;

        // require FULL match
        if (matched.length !== groupedSizes.length) continue;

        const stocks = groupedSizes.map((s) => sizeMap[s]);
        const minStock = Math.min(...stocks);

        result.push({
            sizeRange: range,
            stock: minStock,
        });
    }

    if (itemType === "gents") {
        return result.length
            ? [
                  result.sort(
                      (a, b) =>
                          SIZE_RANGE_TO_SIZES[b.sizeRange].length -
                          SIZE_RANGE_TO_SIZES[a.sizeRange].length,
                  )[0],
              ]
            : [];
    }

    return result;
}

export function isVariantOutOfStock(
    variant: UIVariant,
    itemType: ItemType,
): boolean {
    const sizeRanges = getSizeRangesWithStock(variant, itemType);

    if (sizeRanges.length === 0) {
        return true;
    }

    return sizeRanges.every((s) => s.stock === 0);
}
