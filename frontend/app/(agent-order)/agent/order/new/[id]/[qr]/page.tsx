"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, Info } from "lucide-react";
import { fabricApi } from "@/lib/api/item";
import { orderApi } from "@/lib/api/order";
import { readDraftOrderId } from "@/lib/draftOrder";
import { PageLoading } from "@/components/ui/Loading";
import { toastSuccess, toastError } from "@/lib/toast";
import type { FabricQRResponse, FabricVariant } from "@/types/item";
import { toMeters } from "@/types/item";

import ProductHeader from "./components/ProductHeader";
import ProductImage from "./components/ProductImage";
import ProductInfo from "./components/ProductInfo";
import VariantSelector from "./components/VariantSelector";
import MetresSelector from "./components/MetresSelector";
import SubmitButton from "./components/SubmitButton";
import { useBackButton } from "@/util/useBackButton";
import { useOrderFlow } from "@/context/OrderFlowContext";
import { Modal, ModalButton } from "@/components/ui/custom/Modals";

export default function ProductDetailPage() {
    const params = useParams<{ id: string; qr: string }>();
    const id = params.id as string;
    const router = useRouter();

    const { basePath, agentId } = useOrderFlow();

    const [data, setData] = useState<FabricQRResponse | null>(null);
    const [metres, setMetres] = useState("0");
    const [selectedVariant, setSelectedVariant] = useState<FabricVariant | null>(
        null,
    );
    const [showNotAssignedModal, setShowNotAssignedModal] = useState(false);

    const [pageLoading, setPageLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);

    /** Metres this order already asks for, per colour. */
    const [existingMetres, setExistingMetres] = useState<
        Record<number, number>
    >({});
    /** The line id already on the order for a given colour, per colour. */
    const [lineIdByVariant, setLineIdByVariant] = useState<
        Record<number, number>
    >({});
    const [existingLineId, setExistingLineId] = useState<number | null>(null);

    const isEditMode = existingLineId !== null;

    useBackButton({
        onBack: useCallback(() => {
            router.push(`${basePath}/${id}`);
        }, [router, id, basePath]),
    });

    useEffect(() => {
        setPageLoading(true);
        const fetchData = async () => {
            try {
                const [fabricResponse, orderResponse] = await Promise.all([
                    fabricApi.byQr(params.qr, agentId),
                    (async () => {
                        const orderId = readDraftOrderId();
                        if (!orderId) return null;
                        const order = await orderApi.getOne(orderId);
                        // Never write to an order that belongs to another
                        // customer, however the storage key came to point here.
                        // `customer` is write-only server-side, so the owning
                        // customer only arrives as customer_details.
                        return order.customer_details?.id ===
                            parseInt(id, 10)
                            ? order
                            : null;
                    })(),
                ]);

                setData(fabricResponse);

                const matched =
                    fabricResponse.variants?.find(
                        (v) => v.id === (fabricResponse.matched_variant_id || 0),
                    ) ?? fabricResponse.variants?.[0] ?? null;
                setSelectedVariant(matched);

                if (orderResponse && matched) {
                    // Same colour already on the order: editing beats adding a
                    // second line for it, which is what the merge flow did.
                    const byVariant: Record<number, number> = {};
                    const lineIds: Record<number, number> = {};
                    for (const line of orderResponse.items) {
                        if (!line.variant) continue;
                        byVariant[line.variant] =
                            (byVariant[line.variant] ?? 0) +
                            toMeters(line.ordered_quantity);
                        lineIds[line.variant] = line.id;
                    }
                    setExistingMetres(byVariant);
                    setLineIdByVariant(lineIds);
                    // Follow the matched colour, not the first colour scanned.
                    setExistingLineId(lineIds[matched.id] ?? null);
                    setMetres(
                        byVariant[matched.id]
                            ? String(byVariant[matched.id])
                            : "",
                    );
                }
            } catch (e: any) {
                const errorMsg = e?.response?.data?.error || "";
                if (errorMsg.includes("not assigned to you")) {
                    setShowNotAssignedModal(true);
                } else {
                    console.error("Error fetching fabric details:", e);
                }
            } finally {
                setPageLoading(false);
            }
        };
        fetchData();
    }, [params.qr, agentId, id]);

    const handleVariantSelect = (variant: FabricVariant) => {
        setSelectedVariant(variant);
        setValidationError(null);
        // Switching colour switches which line is being edited, so both the line
        // id and the metre figure have to follow the colour. Leaving the line id
        // on the previously matched colour made "Add to Order" overwrite that
        // other colour's metres, and the new colour was never added at all.
        setExistingLineId(lineIdByVariant[variant.id] ?? null);
        setMetres(
            existingMetres[variant.id]
                ? String(existingMetres[variant.id])
                : "",
        );
    };

    const onHandMetres = selectedVariant ? toMeters(selectedVariant.stock_meters) : 0;

    const requested = useMemo(() => toMeters(metres), [metres]);

    useEffect(() => {
        if (requested > 0) setValidationError(null);
    }, [requested]);

    const handleSubmit = async () => {
        if (!selectedVariant) {
            setValidationError("Choose a colour");
            return;
        }
        if (!selectedVariant.qr_code) {
            setValidationError("This colour has no QR code. Ask an admin to set one.");
            return;
        }
        if (requested <= 0) {
            setValidationError("Enter how many metres are needed");
            return;
        }

        setValidationError(null);

        const orderId = readDraftOrderId();
        if (orderId === null) {
            setValidationError(
                "Order session not found. Please restart the order.",
            );
            return;
        }

        setSubmitting(true);
        try {
            if (existingLineId !== null) {
                await orderApi.updateItem(existingLineId, {
                    ordered_quantity: metres,
                });
                toastSuccess("Fabric line updated");
            } else {
                await orderApi.addItem(orderId, {
                    qr_code: selectedVariant.qr_code,
                    ordered_quantity: metres,
                });
            }

            // Navigate once the write succeeds; success needs no reset.
            router.push(`${basePath}/${id}`);
        } catch (e) {
            console.error("Error adding fabric to order:", e);
            toastError("Failed to add fabric", e);
            setSubmitting(false);
        }
    };

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
                    alt={data?.name || "Fabric"}
                />

                <ProductInfo name={data?.name} />

                <VariantSelector
                    variants={data?.variants || []}
                    selectedVariant={selectedVariant}
                    existingMetresByVariant={existingMetres}
                    onSelect={handleVariantSelect}
                />

                {data?.description && (
                    <>
                        <h3 className="font-bold">Description</h3>
                        <p className="py-2 text-sm text-gray-500">
                            {data.description}
                        </p>
                    </>
                )}

                <MetresSelector
                    metres={metres}
                    onChange={setMetres}
                    onHandMetres={onHandMetres}
                    isEditMode={isEditMode}
                />

                {validationError && (
                    <div className="mb-6 p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-center gap-3 text-rose-500">
                        <Info size={18} className="shrink-0" />
                        <p className="text-xs font-bold uppercase tracking-wider">
                            {validationError}
                        </p>
                    </div>
                )}

                <SubmitButton
                    isEditMode={isEditMode}
                    loading={submitting}
                    disabled={submitting || requested <= 0 || !!validationError}
                    onClick={handleSubmit}
                />
            </div>

            {showNotAssignedModal && (
                <Modal
                    icon={
                        <AlertTriangle size={18} className="text-amber-500" />
                    }
                    iconBg="bg-amber-100"
                    title="Fabric Not Assigned"
                    description="This fabric is not assigned to you."
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
                                Back to order
                            </ModalButton>
                        </>
                    }
                >
                    <div className="bg-amber-50 rounded-xl p-3 border border-amber-100">
                        <p className="text-sm text-amber-800 font-medium">
                            Ask an admin to assign this fabric to you.
                        </p>
                    </div>
                </Modal>
            )}
        </div>
    );
}
