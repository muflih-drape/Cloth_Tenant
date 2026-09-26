"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, Info } from "lucide-react";
import { itemApi } from "@/lib/api/item";
import { orderApi } from "@/lib/api/order";
import { PageLoading } from "@/components/ui/Loading";
import { toastSuccess, toastError } from "@/lib/toast";
import type { ItemQRResponse, ItemVariant } from "@/types/item";

import { getAvailableSizeRanges, getAvailableStockForSizeGroup } from "./utils";

import ProductHeader from "./components/ProductHeader";
import ProductImage from "./components/ProductImage";
import ProductInfo from "./components/ProductInfo";
import VariantSelector from "./components/VariantSelector";
import SizeGroupSelector from "./components/SizeGroupSelector";
import QuantitySelector from "./components/QuantitySelector";
import SubmitButton from "./components/SubmitButton";
import { useBackButton } from "@/util/useBackButton";
import { useOrderFlow } from "@/context/OrderFlowContext";
import { Modal, ModalButton } from "@/components/ui/custom/Modals";

export default function ProductDetailPage() {
    const params = useParams<{ id: string; qr: string }>();
    const id = params.id as string;
    const router = useRouter();

    const { basePath, agentId } = useOrderFlow();

    const [data, setData] = useState<ItemQRResponse | null>(null);
    const [quantity, setQuantity] = useState<number>(1);
    const [selectedVariant, setSelectedVariant] = useState<ItemVariant | null>(
        null,
    );
    const [selectedSizeGroup, setSelectedSizeGroup] = useState<string | null>(
        null,
    );

    const [showNotAssignedModal, setShowNotAssignedModal] = useState(false);

    // ─── Separated loading states ──────────────────────────────────────────────
    const [pageLoading, setPageLoading] = useState(true); // initial data fetch
    const [submitting, setSubmitting] = useState(false); // submit button only

    const [validationError, setValidationError] = useState<string | null>(null);
    const [existingOrderItems, setExistingOrderItems] = useState<
        Array<{
            id: number;
            variant_id: number;
            size_group: string;
            quantity: number;
        }>
    >([]);

    const existingSelectedItem = useMemo(
        () =>
            selectedVariant && selectedSizeGroup
                ? (existingOrderItems.find(
                      (item) =>
                          item.variant_id === selectedVariant.id &&
                          item.size_group === selectedSizeGroup,
                  ) ?? null)
                : null,
        [selectedVariant, selectedSizeGroup, existingOrderItems],
    );
    const isEditMode = existingSelectedItem !== null;
    const editingItemId = existingSelectedItem?.id ?? null;

    useBackButton({
        onBack: useCallback(() => {
            router.push(`${basePath}/${id}`);
        }, [router, id, basePath]),
    });

    // ─── Initial data fetch (pageLoading only) ─────────────────────────────────
    useEffect(() => {
        setPageLoading(true);
        const fetchData = async () => {
            try {
                const [itemResponse, orderResponse] = await Promise.all([
                    itemApi.byqr(params.qr, agentId),
                    (async () => {
                        const orderKey = localStorage.getItem("orderKey");
                        if (orderKey) {
                            return orderApi.getOne(parseInt(orderKey, 10));
                        }
                        return null;
                    })(),
                ]);

                setData(itemResponse);
                if (itemResponse.variants?.length > 0) {
                    setSelectedVariant(
                        itemResponse.variants.find(
                            (v) =>
                                v.id === (itemResponse.matched_variant_id || 0),
                        ) || itemResponse.variants[0],
                    );
                }

                if (orderResponse) {
                    setExistingOrderItems(
                        orderResponse.items.map((item) => ({
                            id: item.id,
                            variant_id: item.variant || 0,
                            size_group: item.size_group || "",
                            quantity: item.quantity,
                        })),
                    );
                }
            } catch (e: any) {
                const errorMsg = e?.response?.data?.error || "";
                if (errorMsg.includes("not assigned to you")) {
                    setShowNotAssignedModal(true);
                } else {
                    console.error("Error fetching product details:", e);
                }
            } finally {
                setPageLoading(false);
            }
        };
        fetchData();
    }, [params.qr, agentId]);

    const sizeGroups = getAvailableSizeRanges(selectedVariant, data?.type);

    const sizeGroupMeta = useMemo(() => {
        if (!selectedVariant)
            return {} as Record<
                string,
                { stock: number; alreadyAdded: boolean }
            >;

        return Object.fromEntries(
            sizeGroups.map((group) => {
                const reservedItems = existingOrderItems
                    .filter(
                        (item) =>
                            item.variant_id === selectedVariant.id &&
                            (isEditMode ? item.id !== editingItemId : true),
                    )
                    .map((item) => ({
                        size_group: item.size_group,
                        quantity: item.quantity,
                    }));

                const stock = getAvailableStockForSizeGroup(
                    selectedVariant,
                    group,
                    reservedItems,
                );
                const alreadyAdded = existingOrderItems.some(
                    (item) =>
                        item.variant_id === selectedVariant.id &&
                        item.size_group === group &&
                        (isEditMode ? item.id !== editingItemId : true),
                );

                return [group, { stock, alreadyAdded }];
            }),
        );
    }, [
        sizeGroups,
        selectedVariant,
        existingOrderItems,
        isEditMode,
        editingItemId,
    ]);

    useEffect(() => {
        if (sizeGroups.length > 0 && !selectedSizeGroup) {
            const reservedItems = existingOrderItems
                .filter((item) => item.variant_id === selectedVariant?.id)
                .map((item) => ({
                    size_group: item.size_group,
                    quantity: item.quantity,
                }));

            const stockFor = (group: string) =>
                getAvailableStockForSizeGroup(
                    selectedVariant,
                    group,
                    reservedItems,
                );
            const isAvailable = (group: string) =>
                sizeGroups.includes(group) && stockFor(group) > 0;

            if (data?.type == "kids") {
                if (isAvailable("20-36")) {
                    setSelectedSizeGroup("20-36");
                } else if (!isAvailable("20-24") && isAvailable("26-36")) {
                    setSelectedSizeGroup("26-36");
                } else if (!isAvailable("32-36") && isAvailable("20-30")) {
                    setSelectedSizeGroup("20-30");
                } else if (isAvailable("20-24")) {
                    setSelectedSizeGroup("20-24");
                } else if (isAvailable("32-36")) {
                    setSelectedSizeGroup("32-36");
                }
            } else {
                const firstAvailable =
                    sizeGroups.find((group) => stockFor(group) > 0) ??
                    sizeGroups[0];
                setSelectedSizeGroup(firstAvailable);
            }
        }
    }, [
        sizeGroups,
        selectedSizeGroup,
        existingOrderItems,
        selectedVariant,
        data?.type,
    ]);

    const availableStock = (() => {
        if (!selectedVariant || !selectedSizeGroup) return 0;

        const reservedItems = existingOrderItems
            .filter(
                (item) =>
                    item.variant_id === selectedVariant.id &&
                    (isEditMode ? item.id !== editingItemId : true),
            )
            .map((item) => ({
                size_group: item.size_group,
                quantity: item.quantity,
            }));

        return getAvailableStockForSizeGroup(
            selectedVariant,
            selectedSizeGroup,
            reservedItems,
        );
    })();

    useEffect(() => {
        if (quantity > availableStock) {
            setValidationError(
                `Only ${availableStock} items available for selected size group`,
            );
        } else {
            setValidationError(null);
        }
    }, [quantity, availableStock]);

    const handleVariantSelect = (variant: ItemVariant) => {
        const existingForThisVariant = existingOrderItems.find(
            (item) => item.variant_id === variant.id,
        );
        setSelectedVariant(variant);
        setSelectedSizeGroup(null);
        setQuantity(existingForThisVariant?.quantity ?? 1);
        setValidationError(null);
    };

    const handleSizeGroupSelect = (value: string) => {
        const existingForSize = existingOrderItems.find(
            (item) =>
                selectedVariant &&
                item.variant_id === selectedVariant.id &&
                item.size_group === value,
        );
        setQuantity(existingForSize?.quantity ?? 1);
        setSelectedSizeGroup(value);
        setValidationError(null);
    };

    // ─── Submit: only setSubmitting, page stays intact ─────────────────────────
    const handleSubmit = async () => {
        if (!selectedVariant) {
            setValidationError("Please select a color/variant");
            return;
        }
        if (!selectedSizeGroup) {
            setValidationError("Please select a size group");
            return;
        }
        if (quantity < 1) {
            setValidationError("Quantity must be at least 1");
            return;
        }
        if (quantity > availableStock) {
            setValidationError(
                `Only ${availableStock} items available for selected size group`,
            );
            return;
        }

        setValidationError(null);

        const orderKey = localStorage.getItem("orderKey");
        if (!orderKey) {
            setValidationError(
                "Order session not found. Please restart the order.",
            );
            return;
        }

        setSubmitting(true);
        try {
            const orderId = parseInt(orderKey, 10);

            const existingSameVariant = existingOrderItems.find(
                (item) =>
                    item.variant_id === selectedVariant.id &&
                    item.size_group === selectedSizeGroup,
            );

            if (existingSameVariant && !isEditMode) {
                // ── Update quantity for duplicate variant+size ────────────────────────
                await orderApi.updateItem(existingSameVariant.id, {
                    quantity: existingSameVariant.quantity + quantity,
                });
                toastSuccess("Quantity Updated");
            } else if (isEditMode && editingItemId) {
                // ── Edit existing item ───────────────────────────────────────────────
                await orderApi.updateItem(editingItemId, { quantity });
                toastSuccess("Item Updated");
            } else {
                // ── Add new item — no extra getOne() round-trip ──────────────────────
                await orderApi.addItem(orderId, {
                    qr_code: selectedVariant.qr_code,
                    quantity,
                    size_group: selectedSizeGroup,
                });
            }

            // Navigate once all branches succeed — no setSubmitting(false) needed
            router.push(`${basePath}/${id}`);
        } catch (e) {
            console.error("Error adding item to order:", e);
            toastError("Failed to add item", e);
            setSubmitting(false); // only reset on error; navigation handles success
        }
    };

    // ─── Only the initial fetch blocks the full page ────────────────────────────
    if (pageLoading) return <PageLoading />;

    return (
        <div className="min-h-screen bg-gray-50/50 pb-32">
            <ProductHeader
                isEditMode={isEditMode}
                onBack={() => router.push(`${basePath}/${id}`)}
            />

            <div className="max-w-md mx-auto px-6 pt-6">
                <ProductImage
                    image={selectedVariant?.image}
                    alt={data?.name || "Product"}
                />

                <ProductInfo name={data?.name} />

                <VariantSelector
                    variants={data?.variants || []}
                    selectedVariant={selectedVariant}
                    existingOrderItems={existingOrderItems}
                    selectedSizeGroup={selectedSizeGroup}
                    onSelect={handleVariantSelect}
                />
                <h3 className="font-bold">Description</h3>
                <h4 className="py-2">{data?.description}</h4>

                <SizeGroupSelector
                    sizeGroups={sizeGroups}
                    selectedSizeGroup={selectedSizeGroup}
                    availableStock={availableStock}
                    sizeGroupMeta={sizeGroupMeta}
                    onSelect={handleSizeGroupSelect}
                />

                <QuantitySelector
                    quantity={quantity}
                    availableStock={availableStock}
                    isEditMode={isEditMode}
                    onChange={setQuantity}
                />

                {validationError && (
                    <div className="mb-6 p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-center gap-3 text-rose-500 animate-in fade-in slide-in-from-top-2">
                        <Info size={18} />
                        <p className="text-xs font-bold uppercase tracking-wider">
                            {validationError}
                        </p>
                    </div>
                )}

                {/* submitting → spinner on button only, not full-page takeover */}
                <SubmitButton
                    isEditMode={isEditMode}
                    loading={submitting}
                    disabled={
                        submitting || availableStock === 0 || !!validationError
                    }
                    onClick={handleSubmit}
                />
            </div>

            {showNotAssignedModal && (
                <Modal
                    icon={
                        <AlertTriangle size={18} className="text-amber-500" />
                    }
                    iconBg="bg-amber-100"
                    title="Color Not Assigned!"
                    description="This color is not assigned to you."
                    onClose={() => setShowNotAssignedModal(false)}
                    actions={
                        <>
                            <ModalButton
                                variant="ghost"
                                onClick={() => {
                                    setShowNotAssignedModal(false);
                                    router.push(
                                        `${basePath}/${id}/scanner`,
                                    );
                                }}
                            >
                                Scan another QR
                            </ModalButton>

                            <ModalButton
                                variant="primary"
                                onClick={() => {
                                    setShowNotAssignedModal(false);
                                    router.push(`${basePath}/${id}`);
                                }}
                            >
                                Back to Orders
                            </ModalButton>
                        </>
                    }
                >
                    <div className="bg-amber-50 rounded-xl p-3 border border-amber-100">
                        <p className="text-sm text-amber-800 font-medium">
                            Ask admin to assign this color to you.
                        </p>
                    </div>
                </Modal>
            )}
        </div>
    );
}
