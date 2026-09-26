"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { fabricApi } from "@/lib/api/item";
import { orderApi } from "@/lib/api/order";
import { PageLoading } from "@/components/ui/Loading";
import { toastSuccess, toastError } from "@/lib/toast";
import type { FabricQRResponse, FabricVariant } from "@/types/item";
import { toMeters } from "@/types/item";
import { useEditGuard } from "@/lib/useEditGuard";

import ProductHeader from "../../../new/[id]/[qr]/components/ProductHeader";
import ProductImage from "../../../new/[id]/[qr]/components/ProductImage";
import ProductInfo from "../../../new/[id]/[qr]/components/ProductInfo";
import VariantSelector from "../../../new/[id]/[qr]/components/VariantSelector";
import MetresSelector from "../../../new/[id]/[qr]/components/MetresSelector";
import SubmitButton from "../../../new/[id]/[qr]/components/SubmitButton";

export default function EditProductDetailPage() {
  const params = useParams<{ id: string; qr: string }>();
  const id = params.id as string;
  const router = useRouter();
  const { handleBack } = useEditGuard(id);

  const [data, setData] = useState<FabricQRResponse | null>(null);
  const [metres, setMetres] = useState("0");
  const [selectedVariant, setSelectedVariant] = useState<FabricVariant | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [existingMetres, setExistingMetres] = useState<Record<number, number>>(
    {},
  );
  const [existingLineId, setExistingLineId] = useState<number | null>(null);

  const isEditMode = existingLineId !== null;

  useEffect(() => {
    setLoading(true);
    const fetchData = async () => {
      try {
        const [fabricResponse, orderResponse] = await Promise.all([
          fabricApi.byQr(params.qr),
          (async () => {
            const orderKey = localStorage.getItem("orderKey");
            if (orderKey) {
              return orderApi.getOne(parseInt(orderKey, 10));
            }
            return null;
          })(),
        ]);

        setData(fabricResponse);

        const matched =
          fabricResponse.variants?.find(
            (v) => v.id === (fabricResponse.matched_variant_id || 0),
          ) ?? fabricResponse.variants?.[0] ?? null;
        setSelectedVariant(matched);

        if (orderResponse && matched) {
          const byVariant: Record<number, number> = {};
          for (const line of orderResponse.items) {
            if (line.variant) {
              byVariant[line.variant] =
                (byVariant[line.variant] ?? 0) + toMeters(line.ordered_quantity);
            }
          }
          setExistingMetres(byVariant);

          // Reuse this colour's line if the order already has one, so scanning
          // the same roll twice adjusts it rather than duplicating it.
          const sameVariant = orderResponse.items.find(
            (line) => line.variant === matched.id,
          );
          if (sameVariant) {
            setExistingLineId(sameVariant.id);
            setMetres(sameVariant.ordered_quantity);
          }
        }
      } catch (e) {
        console.error("Error fetching fabric details:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [params.qr]);

  const handleVariantSelect = (variant: FabricVariant) => {
    setSelectedVariant(variant);
    setValidationError(null);
    const onOrder = existingMetres[variant.id];
    if (onOrder) setMetres(String(onOrder));
  };

  const onHandMetres = selectedVariant ? toMeters(selectedVariant.stock_meters) : 0;
  const requested = useMemo(() => toMeters(metres), [metres]);

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

    try {
      setLoading(true);
      const orderKey = localStorage.getItem("orderKey");
      if (!orderKey) {
        setValidationError("Order session not found. Please restart the order.");
        setLoading(false);
        return;
      }
      const orderId = parseInt(orderKey, 10);

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
        toastSuccess("Fabric added");
      }
      router.push(`/agent/order/edit/${id}`);
    } catch (e) {
      console.error("Error adding fabric to order:", e);
      toastError("Failed to add fabric", e);
      setLoading(false);
    }
  };

  if (loading) return <PageLoading />;

  return (
    <div className="min-h-screen bg-gray-50/50 pb-32">
      <ProductHeader isEditMode={isEditMode} onBack={handleBack} />

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
          loading={loading}
          disabled={loading || requested <= 0 || !!validationError}
          onClick={handleSubmit}
        />
      </div>
    </div>
  );
}
