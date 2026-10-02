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
import { useAuth } from "@/context/AuthContext";

import ProductHeader from "../../../new/[id]/[qr]/components/ProductHeader";
import ProductImage from "../../../new/[id]/[qr]/components/ProductImage";
import ProductInfo from "../../../new/[id]/[qr]/components/ProductInfo";
import VariantSelector from "../../../new/[id]/[qr]/components/VariantSelector";
import MetresSelector from "../../../new/[id]/[qr]/components/MetresSelector";
import RateOverrideSelector from "../../../new/[id]/[qr]/components/RateOverrideSelector";
import SubmitButton from "../../../new/[id]/[qr]/components/SubmitButton";

export default function EditProductDetailPage() {
  const params = useParams<{ id: string; qr: string }>();
  const id = params.id as string;
  const router = useRouter();
  const { handleBack } = useEditGuard(id);
  const { role } = useAuth();

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
  const [lineIdByVariant, setLineIdByVariant] = useState<Record<number, number>>(
    {},
  );
const [rateByVariant, setRateByVariant] = useState<Record<number, string>>(
    {},
);
const [overriddenByVariant, setOverriddenByVariant] = useState<
    Record<number, boolean>
>({});
  const [rate, setRate] = useState("");
  const [existingLineId, setExistingLineId] = useState<number | null>(null);

  const isEditMode = existingLineId !== null;

  useEffect(() => {
    setLoading(true);
    const fetchData = async () => {
      try {
        const [fabricResponse, orderResponse] = await Promise.all([
          fabricApi.byQr(params.qr),
          orderApi.getOne(parseInt(id, 10)),
        ]);

        setData(fabricResponse);

        const matched =
          fabricResponse.variants?.find(
            (v) => v.id === (fabricResponse.matched_variant_id || 0),
          ) ?? fabricResponse.variants?.[0] ?? null;
        setSelectedVariant(matched);

        if (orderResponse && matched) {
          const byVariant: Record<number, number> = {};
          const lineIds: Record<number, number> = {};
          const rates: Record<number, string> = {};
          const overrides: Record<number, boolean> = {};
          for (const line of orderResponse.items) {
            if (!line.variant) continue;
            byVariant[line.variant] =
              (byVariant[line.variant] ?? 0) + toMeters(line.ordered_quantity);
            lineIds[line.variant] = line.id;
            rates[line.variant] = line.rate_per_meter;
            // The server's own answer to "was this line repriced?" — comparing
            // against the live catalogue price instead would flag every line
            // added before a price change.
            overrides[line.variant] = !!line.is_rate_overridden;
          }
          setExistingMetres(byVariant);
          setLineIdByVariant(lineIds);
          setRateByVariant(rates);
          setOverriddenByVariant(overrides);

          // Reuse this colour's line if the order already has one, so scanning
          // the same roll twice adjusts it rather than duplicating it. The line
          // follows the selected colour, not the colour first scanned.
          setExistingLineId(lineIds[matched.id] ?? null);
          setMetres(byVariant[matched.id] ? String(byVariant[matched.id]) : "");
          setRate(rates[matched.id] ?? fabricResponse.price_per_meter);
        } else if (matched) {
          setRate(fabricResponse.price_per_meter);
        }
      } catch (e) {
        console.error("Error fetching fabric details:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [params.qr, id]);

  const handleVariantSelect = (variant: FabricVariant) => {
    setSelectedVariant(variant);
    setValidationError(null);
    // Both the target line and the metre figure belong to the selected colour;
    // carrying the previous colour's line id overwrote the wrong line.
    setExistingLineId(lineIdByVariant[variant.id] ?? null);
    setMetres(
      existingMetres[variant.id] ? String(existingMetres[variant.id]) : "",
    );
    // So does the rate: keep the agreed one rather than silently falling back
    // to the catalogue price, which would reprice the line on save.
    setRate(rateByVariant[variant.id] ?? data?.price_per_meter ?? "");
  };

  const onHandMetres = selectedVariant ? toMeters(selectedVariant.stock_meters) : 0;
  const requested = useMemo(() => toMeters(metres), [metres]);

  const catalogRate = data?.price_per_meter ?? "";
  const existingRate = selectedVariant
    ? rateByVariant[selectedVariant.id]
    : undefined;
  const isOverridden = selectedVariant
    ? !!overriddenByVariant[selectedVariant.id]
    : false;
  /**
   * The rate to send, or nothing when there is nothing to say. A line that
   * already carries this rate and was never repriced is left alone: its rate is
   * a snapshot, and re-sending it could put a stale figure through the agent
   * cap. An overridden line always sends, since that is how the agreement is
   * changed or cleared.
   */
  const rateOverride = useMemo(() => {
    const typed = Number(rate);
    const catalog = Number(catalogRate);
    if (!rate.trim() || !Number.isFinite(typed) || typed <= 0) return null;
    const stored = existingRate !== undefined ? Number(existingRate) : NaN;
    if (!isOverridden) {
      if (Number.isFinite(stored) && typed === stored) return null;
      if (typed === catalog) return null;
    }
    return rate.trim();
  }, [rate, catalogRate, existingRate, isOverridden]);

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
    const typedRate = Number(rate);
    if (!rate.trim() || !Number.isFinite(typedRate) || typedRate <= 0) {
      setValidationError("Enter the rate to charge per metre");
      return;
    }
    // Pinned by the server too; catching it here keeps the agent from filling
    // in a form that can only come back rejected. Keeping the rate a line
    // already carries is not inflation, even once the catalogue has moved past
    // it.
    const keepingAgreedRate =
      isOverridden &&
      existingRate !== undefined &&
      typedRate === Number(existingRate);
    if (
      role !== "ADMIN" &&
      !keepingAgreedRate &&
      typedRate > Number(catalogRate)
    ) {
      setValidationError(
        `Rate cannot be more than the catalogue price of ₹${catalogRate}/m`,
      );
      return;
    }

    setValidationError(null);

    try {
      setLoading(true);
      // On this route the id *is* the order id, so there is no session key to
      // consult and no way to act on an order the agent is not editing.
      const orderId = parseInt(id, 10);

      if (existingLineId !== null) {
        await orderApi.updateItem(existingLineId, {
          ordered_quantity: metres,
          ...(rateOverride ? { rate_override: rateOverride } : {}),
        });
        toastSuccess("Fabric line updated");
      } else {
        await orderApi.addItem(orderId, {
          qr_code: selectedVariant.qr_code,
          ordered_quantity: metres,
          ...(rateOverride ? { rate_override: rateOverride } : {}),
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

        <RateOverrideSelector
          catalogRate={catalogRate}
          value={rate}
          onChange={setRate}
          canRaiseRate={role === "ADMIN"}
          isOverridden={isOverridden}
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
