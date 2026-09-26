"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { itemApi } from "@/lib/api/item";
import { orderApi } from "@/lib/api/order";
import { PageLoading } from "@/components/ui/Loading";
import { toastSuccess, toastError } from "@/lib/toast";
import type { ItemQRResponse, ItemVariant } from "@/types/item";
import { useEditGuard } from "@/lib/useEditGuard";

import {
  getAvailableSizeRanges,
  getMaxSizeGroup,
  getAvailableStockForSizeGroup,
} from "../../../new/[id]/[qr]/utils";

import ProductHeader from "../../../new/[id]/[qr]/components/ProductHeader";
import ProductImage from "../../../new/[id]/[qr]/components/ProductImage";
import ProductInfo from "../../../new/[id]/[qr]/components/ProductInfo";
import VariantSelector from "../../../new/[id]/[qr]/components/VariantSelector";
import QuantitySelector from "../../../new/[id]/[qr]/components/QuantitySelector";
import SubmitButton from "../../../new/[id]/[qr]/components/SubmitButton";
import SizeGroupSelector from "../../../new/[id]/[qr]/components/SizeGroupSelector";

export default function EditProductDetailPage() {
  const params = useParams<{ id: string; qr: string }>();
  const id = params.id as string;
  const router = useRouter();
  const { handleBack } = useEditGuard(id);

  const [data, setData] = useState<ItemQRResponse | null>(null);
  const [quantity, setQuantity] = useState<number>(1);
  const [selectedVariant, setSelectedVariant] = useState<ItemVariant | null>(
    null,
  );
  const [selectedSizeGroup, setSelectedSizeGroup] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [existingOrderItems, setExistingOrderItems] = useState<
    Array<{
      id: number;
      variant_id: number;
      size_group: string;
      quantity: number;
    }>
  >([]);

  useEffect(() => {
    setLoading(true);
    const fetchData = async () => {
      try {
        const [itemResponse, orderResponse] = await Promise.all([
          itemApi.byqr(params.qr),
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
              (v) => v.id === (itemResponse.matched_variant_id || 0),
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
      } catch (e) {
        console.error("Error fetching product details:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [params.qr]);

  const sizeGroups = getAvailableSizeRanges(selectedVariant, data?.type);

  const sizeGroupMeta = useMemo(() => {
    if (!selectedVariant)
      return {} as Record<string, { stock: number; alreadyAdded: boolean }>;

    return Object.fromEntries(
      sizeGroups.map((group) => {
        const reservedItems = existingOrderItems
          .filter((item) => item.variant_id === selectedVariant.id)
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
            item.variant_id === selectedVariant.id && item.size_group === group,
        );

        return [group, { stock, alreadyAdded }];
      }),
    );
  }, [sizeGroups, selectedVariant, existingOrderItems]);

  useEffect(() => {
    if (sizeGroups.length > 0 && !selectedSizeGroup) {
      setSelectedSizeGroup(getMaxSizeGroup(sizeGroups));
    }
  }, [sizeGroups, selectedSizeGroup]);

  const availableStock = (() => {
    if (!selectedVariant || !selectedSizeGroup) return 0;

    const reservedItems = existingOrderItems
      .filter((item) => item.variant_id === selectedVariant.id)
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

  const existingSameVariantAndSize = (() => {
    if (!selectedVariant || !selectedSizeGroup) return null;
    return existingOrderItems.find(
      (item) =>
        item.variant_id === selectedVariant.id &&
        item.size_group === selectedSizeGroup,
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
    setSelectedVariant(variant);
    setQuantity(1);
    setValidationError(null);
  };

  const handleSizeGroupSelect = (value: string) => {
    setSelectedSizeGroup(value);
    setQuantity(1);
    setValidationError(null);
  };

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

    try {
      setLoading(true);
      const orderKey = localStorage.getItem("orderKey");
      if (orderKey) {
        const orderId = parseInt(orderKey, 10);
        const qrCode = selectedVariant.qr_code;

        await orderApi.addItem(orderId, {
          qr_code: qrCode,
          quantity,
          size_group: selectedSizeGroup,
        });
        setExistingOrderItems((prev) => [
          ...prev,
          {
            id: Date.now(),
            variant_id: selectedVariant.id,
            size_group: selectedSizeGroup,
            quantity,
          },
        ]);
        toastSuccess("Item Added Successfully");
        router.push(`/agent/order/edit/${id}`);
      } else {
        setValidationError(
          "Order session not found. Please restart the order.",
        );
      }
    } catch (e) {
      console.error("Error adding item to order:", e);
      toastError("Failed to add item", e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <PageLoading />;

  return (
    <div className="min-h-screen bg-gray-50/50 pb-32">
      <ProductHeader isEditMode={false} onBack={handleBack} />

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
          isEditMode={false}
          onChange={setQuantity}
        />

        {existingSameVariantAndSize && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-start gap-3">
            <Info size={18} className="text-amber-500 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-800 font-medium">
              You already added {existingSameVariantAndSize.quantity} sets of
              this color and size range. Submitting will add a new separate
              item.
            </p>
          </div>
        )}

        {validationError && (
          <div className="mb-6 p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-center gap-3 text-rose-500 animate-in fade-in slide-in-from-top-2">
            <Info size={18} />
            <p className="text-xs font-bold uppercase tracking-wider">
              {validationError}
            </p>
          </div>
        )}

        <SubmitButton
          isEditMode={false}
          loading={loading}
          disabled={availableStock === 0 || !!validationError}
          onClick={handleSubmit}
        />
      </div>
    </div>
  );
}
