"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Scanner } from "@yudiel/react-qr-scanner";
import { ImagePreview } from "@/components/pages/ImagePreview";
import { itemApi } from "@/lib/api/item";
import { customerApi } from "@/lib/api/customer";
import { PageLoading } from "@/components/ui/Loading";
import { toastError } from "@/lib/toast";
import {
  ArrowLeft,
  QrCode,
  Package,
  Check,
  X,
  ShoppingCart,
} from "lucide-react";
import type { ItemQRResponse, ItemVariant, ItemType } from "@/types/item";
import {
  SIZE_RANGE_TO_SIZES,
  FrontendSizeRange,
  SIZE_RANGE_PIECE_COUNT,
  getSizesForItemType,
} from "@/types/item";
import type { CustomerAllResponse } from "@/types/customer";

function getAvailableSizeRanges(
  variant: ItemVariant | null,
  type: ItemType | undefined,
): string[] {
  if (!variant || !type) return [];

  const variantSizes = Array.from(
    new Set(
      variant.sizes
        .map((s) => s.size_range)
        .filter((s): s is string => s !== undefined),
    ),
  );
  const variantSizeSet = new Set(variantSizes);

  const availableRanges = getSizesForItemType(type, "order_creation");

  if (type === "gents") {
    for (const range of availableRanges) {
      const rangeSizes = SIZE_RANGE_TO_SIZES[range];
      const rangeSizeSet = new Set(rangeSizes);
      if (
        rangeSizeSet.size === variantSizeSet.size &&
        [...rangeSizeSet].every((s) => variantSizeSet.has(s))
      ) {
        return [range];
      }
    }
    return variantSizes;
  }

  return availableRanges.filter((range) => {
    const requiredSizes = SIZE_RANGE_TO_SIZES[range];
    return requiredSizes.every((s) => variantSizeSet.has(s));
  });
}

function getSizeGroupStock(
  variant: ItemVariant | null,
  sizeGroup: string,
): number {
  if (!variant) return 0;
  const sizes = SIZE_RANGE_TO_SIZES[sizeGroup as FrontendSizeRange] || [];
  let minStock = Infinity;
  for (const size of sizes) {
    const sizeObj = variant.sizes.find((s) => s.size_range === size);
    if (!sizeObj) return 0;
    minStock = Math.min(minStock, sizeObj.stock);
  }
  return minStock === Infinity ? 0 : minStock;
}

export default function PriceCheckScannerPage() {
  const router = useRouter();
  const [scanResult, setScanResult] = useState<ItemQRResponse | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<ItemVariant | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [showCustomerSelect, setShowCustomerSelect] = useState(false);
  const [customers, setCustomers] = useState<CustomerAllResponse>([]);
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    const fetchCustomers = async () => {
      try {
        const data = await customerApi.getAll();
        setCustomers(data.results);
      } catch (err) {
        console.error("Error fetching customers:", err);
      }
    };
    fetchCustomers();
  }, []);

  const handleScan = async (data: { rawValue: string }[]) => {
    if (scanned || !data[0]?.rawValue) return;

    setScanned(true);
    setLoading(true);

    try {
      const result = await itemApi.byqr(data[0].rawValue);
      setScanResult(result);
      if (result.matched_variant_id) {
        const matched = result.variants.find(
          (v) => v.id === result.matched_variant_id,
        );
        setSelectedVariant(matched || result.variants[0] || null);
      } else {
        setSelectedVariant(result.variants[0] || null);
      }
    } catch (err: any) {
      console.error("Error fetching item:", err);
      toastError(err.response?.data?.error || "Item not found", err);
      setScanned(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectCustomer = (customerId: number) => {
    if (scanResult && selectedVariant) {
      const qrCode = selectedVariant.qr_code;
      if (qrCode) {
        router.push(`/agent/order/new/${customerId}/${qrCode}`);
      }
    }
  };

  const handleQuickOrder = () => {
    setShowCustomerSelect(true);
  };

  const handleCloseCustomerSelect = () => {
    setShowCustomerSelect(false);
  };

  const handleScanAnother = () => {
    setScanResult(null);
    setSelectedVariant(null);
    setScanned(false);
  };

  if (loading) return <PageLoading />;

  if (showCustomerSelect) {
    return (
      <div className="min-h-screen bg-gray-50/50 pb-20">
        <div className="bg-white border-b border-gray-100 px-6 py-6 sticky top-0 z-10">
          <div className="max-w-md mx-auto flex items-center gap-4">
            <button
              onClick={handleCloseCustomerSelect}
              className="p-2 rounded-xl hover:bg-gray-50 text-gray-400 transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="flex flex-col">
              <h1 className="text-xl font-black text-gray-900 leading-tight">
                Select Customer
              </h1>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                For quick order
              </p>
            </div>
          </div>
        </div>

        <div className="max-w-md mx-auto pt-6">
          {customers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-300">
              <p className="text-sm text-gray-400">No customers found</p>
            </div>
          ) : (
            <div className="space-y-3">
              {customers.map((customer) => (
                <button
                  key={customer.id}
                  onClick={() => handleSelectCustomer(customer.id)}
                  className="w-full flex items-center gap-4 bg-white border border-gray-100 p-4 hover:border-color-primary/30 hover:shadow-md transition-all rounded-2xl active:scale-[0.98] text-left"
                >
                  <div className="w-12 h-12 rounded-xl bg-color-primary/5 flex items-center justify-center border border-color-primary/10 flex-shrink-0">
                    <span className="text-lg font-black text-color-primary">
                      {customer.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h6 className="font-bold text-gray-900 text-[16px]">
                      {customer.name}
                    </h6>
                    <p className="text-xs text-gray-400 truncate mt-1 leading-tight font-medium">
                      {customer.address || "No address"}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (scanResult) {
    return (
      <div className="min-h-screen bg-gray-50/50 pb-20">
        <div className="bg-white border-b border-gray-100 px-6 py-6 sticky top-0 z-10">
          <div className="max-w-md mx-auto flex items-center justify-between">
            <button
              onClick={() => router.push("/agent/items")}
              className="p-2 rounded-xl hover:bg-gray-50 text-gray-400 transition-colors"
            >
              <X size={20} />
            </button>
            <div className="flex flex-col text-center">
              <h1 className="text-lg font-black text-gray-900 leading-tight">
                Price Check
              </h1>
              <p className="text-[10px] text-green-500 font-bold uppercase tracking-wider">
                Item Details
              </p>
            </div>
            <button
              onClick={handleScanAnother}
              className="p-2 rounded-xl hover:bg-gray-50 text-gray-400 transition-colors"
            >
              <QrCode size={20} />
            </button>
          </div>
        </div>

        <div className="max-w-md mx-auto px-6 pt-6">
          <div className="bg-white rounded-[40px] overflow-hidden shadow-xl shadow-color-primary/5 border border-gray-100 mb-4 aspect-square relative">
            {selectedVariant?.image ? (
              <ImagePreview src={selectedVariant.image} alt={scanResult.name} />
            ) : (
              <div className="w-full h-full bg-gray-50 flex items-center justify-center">
                <Package size={64} className="text-gray-200" />
              </div>
            )}
          </div>

          <div className="mb-6">
            <div className="flex p-2 gap-4 overflow-x-auto pb-2 scrollbar-none">
              {scanResult.variants.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedVariant(v)}
                  className={`relative flex-shrink-0 w-20 h-20 rounded-3xl border-2 transition-all overflow-hidden ${
                    selectedVariant?.id === v.id
                      ? "border border-primary scale-105"
                      : "border hover:border-gray-200"
                  }`}
                >
                  {v.image ? (
                    <ImagePreview
                      src={v.image}
                      alt={`Variant ${v.id}`}
                      enlargeDisabled={true}
                    />
                  ) : (
                    <div className="w-full h-full bg-gray-100" />
                  )}
                  {selectedVariant?.id === v.id && (
                    <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                      <Check className="text-white" size={24} strokeWidth={4} />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="text-center mb-6">
            <h2 className="text-2xl font-black text-gray-900 mb-1">
              {scanResult.name}
            </h2>
            <span className="inline-block px-3 py-1 bg-color-primary/10 text-color-primary rounded-full text-xs font-bold uppercase tracking-wider">
              {scanResult.type}
            </span>
          </div>

          <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-100 rounded-3xl p-6 mb-6">
            <p className="text-[10px] font-black uppercase tracking-widest text-green-600 mb-1">
              Price
            </p>
            <p className="text-4xl font-black text-green-700">
              ₹{scanResult.price}
            </p>
          </div>

          {(() => {
            const sizeGroups = getAvailableSizeRanges(
              selectedVariant,
              scanResult.type as ItemType,
            );
            return sizeGroups.length > 0 ? (
              <div className="mb-6">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">
                  Available Size Groups
                </p>
                <div className="flex flex-wrap gap-2">
                  {sizeGroups.map((group) => {
                    const stock = getSizeGroupStock(selectedVariant, group);
                    const setsAvailable = Math.floor(stock);
                    const piecesPerSet = SIZE_RANGE_PIECE_COUNT[group] || 1;
                    return (
                      <div
                        key={group}
                        className="flex-shrink-0 px-3 py-2 rounded-lg min-w-[80px] bg-gray-50"
                      >
                        <span className="text-xs font-bold block text-gray-700">
                          {group}
                        </span>
                        <span className="text-sm font-black block text-gray-900">
                          {setsAvailable} Sets
                        </span>
                        <span className="text-[10px] text-gray-400 block">
                          {piecesPerSet} pcs/set
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="mb-6">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">
                  Availability
                </p>
                <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-100 rounded-xl">
                  <span className="font-bold text-sm text-red-500">
                    Out of stock
                  </span>
                </div>
              </div>
            );
          })()}

          <button
            onClick={handleQuickOrder}
            className="w-full mb-6 flex items-center justify-center gap-3 bg-linear-to-r from-primary to-primary/80 text-white py-4 px-6 rounded-2xl shadow-lg shadow-primary/25 active:scale-[0.98] transition-all"
          >
            <ShoppingCart size={20} strokeWidth={2.5} />
            Order for Customer
          </button>

          <button
            onClick={handleScanAnother}
            className="w-full mt-3 flex items-center justify-center gap-2 text-gray-400 border rounded-2xl border-gray-400 py-3 font-bold text-sm active:scale-[0.98] transition-all"
          >
            <QrCode size={16} />
            Scan Another Item
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/50 pb-20">
      <div className="bg-white border-b border-gray-100 px-6 py-6 sticky top-0 z-10">
        <div className="max-w-md mx-auto flex items-center gap-4">
          <button
            onClick={() => router.push("/agent/items")}
            className="p-2 rounded-xl hover:bg-gray-50 text-gray-400 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex flex-col">
            <h1 className="text-xl font-black text-gray-900 leading-tight">
              Scan Item
            </h1>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
              Check price
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto px-6 pt-4 flex flex-col items-center">
        <div className="relative w-full aspect-square max-w-[280px]">
          <div className="absolute -top-2 -left-2 w-8 h-8 border-t-4 border-l-4 border-color-primary rounded-tl-2xl z-20" />
          <div className="absolute -top-2 -right-2 w-8 h-8 border-t-4 border-r-4 border-color-primary rounded-tr-2xl z-20" />
          <div className="absolute -bottom-2 -left-2 w-8 h-8 border-b-4 border-l-4 border-color-primary rounded-bl-2xl z-20" />
          <div className="absolute -bottom-2 -right-2 w-8 h-8 border-b-4 border-r-4 border-color-primary rounded-br-2xl z-20" />

          <div className="relative w-full h-full rounded-[32px] overflow-hidden bg-black shadow-2xl ring-8 ring-white/50">
            <Scanner
              constraints={{
                facingMode: "environment",
                width: { ideal: 1280 },
                height: { ideal: 720 },
              }}
              onScan={handleScan}
              onError={(err) => console.error(err)}
              classNames={{
                container: "w-full h-full",
                video: "w-full h-full object-cover",
              }}
            />
          </div>
        </div>

        <div className="mt-8 text-center">
          <div className="inline-flex items-center gap-2 bg-color-primary/10 text-color-primary px-4 py-2 rounded-full border border-color-primary/20 mb-4">
            <QrCode size={16} />
            <span className="text-xs font-black uppercase tracking-widest">
              Price Check
            </span>
          </div>
          <h2 className="text-lg font-bold text-gray-800">Scan Item QR</h2>
          <p className="text-sm text-gray-400 mt-2 max-w-[200px] mx-auto leading-relaxed font-medium">
            Scan an item&apos;s QR code to view price and details
          </p>
        </div>
      </div>
    </div>
  );
}
