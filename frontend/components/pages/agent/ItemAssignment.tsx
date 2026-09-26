"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Item } from "@/types/item";
import { ImagePreview } from "@/components/pages/ImagePreview";
import { toastSuccess, toastError } from "@/lib/toast";
import { Package, Scan, Download, ScanLine } from "lucide-react";
import { pdf } from "@react-pdf/renderer";
import AssignedItemsPDF from "@/components/pages/agent/AssignedItemsPDF";
import type { PDFVariant } from "@/components/pages/agent/AssignedItemsPDF";
import QRScanModal from "@/components/items/QRScanModal";

type Tab = "Recent" | "Assigned";
type ScanMode = "add" | "remove";

interface VariantDisplay {
  variantId: number;
  itemId: number;
  itemName: string;
  itemType?: string;
  itemPrice: string;
  image: string | null;
  qrCode: string | null;
  sizes: { size: string; stock: number }[];
  createdAt: string | null;
  isUnsaved: boolean;
  isPendingRemoval: boolean;
}

interface ItemAssignmentProps {
  agentId: number;
  agentName: string;
  items: Item[];
  selectedVariantIds: number[];
  savedVariantIds: number[];
  variantCreatedAt: Map<number, string>;
  onToggleVariant: (variantId: number) => void;
  onSaveItems: () => void;
  savingItems: boolean;
  hasChanges: boolean;
}

const urlToDataUrl = async (url: string): Promise<string | null> => {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(blob);
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(objectUrl);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(null);
      };
      img.src = objectUrl;
    });
  } catch {
    return null;
  }
};

export default function ItemAssignment({
  agentId,
  agentName,
  items,
  selectedVariantIds,
  savedVariantIds,
  variantCreatedAt,
  onToggleVariant,
  onSaveItems,
  savingItems,
  hasChanges,
}: ItemAssignmentProps) {
  const [activeTab, setActiveTab] = useState<Tab>("Recent");
  const [scanMode, setScanMode] = useState<ScanMode>("add");
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [generatingPDF, setGeneratingPDF] = useState(false);
  const [pendingRemovalIds, setPendingRemovalIds] = useState<Set<number>>(
    new Set(),
  );

  // Clear pending removals once the parent confirms a save (savedVariantIds reference changes)
  useEffect(() => {
    setPendingRemovalIds(new Set());
  }, [savedVariantIds]);

  const allVariants = useMemo(() => {
    const result: VariantDisplay[] = [];

    const sortedItems = [...items].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );

    for (const item of sortedItems) {
      for (const variant of item.variants || []) {
        const createdAt = variantCreatedAt.get(variant.id) ?? null;
        result.push({
          variantId: variant.id,
          itemId: item.id,
          itemName: item.name,
          itemType: item.type,
          itemPrice: item.price,
          image: variant.image ?? null,
          qrCode: variant.qr_code ?? null,
          sizes: (variant.sizes || []).map((s) => ({
            size: s.size!,
            stock: s.stock,
          })),
          createdAt,
          isUnsaved:
            !savedVariantIds.includes(variant.id) &&
            selectedVariantIds.includes(variant.id),
          isPendingRemoval: pendingRemovalIds.has(variant.id),
        });
      }
    }
    return result;
  }, [
    items,
    variantCreatedAt,
    savedVariantIds,
    selectedVariantIds,
    pendingRemovalIds,
  ]);

  const recentIds = useMemo(() => {
    const now = new Date();
    const yesterdayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 1,
      0,
      1,
      0,
      0,
    );

    const recentlySaved = savedVariantIds.filter((id) => {
      const createdAt = variantCreatedAt.get(id);
      return createdAt && new Date(createdAt) >= yesterdayStart;
    });

    const unsaved = selectedVariantIds.filter(
      (id) => !savedVariantIds.includes(id),
    );

    const combined = [...new Set([...recentlySaved, ...unsaved])];

    return combined.sort((a, b) => {
      const aDate = variantCreatedAt.get(a);
      const bDate = variantCreatedAt.get(b);
      if (!aDate && !bDate) return 0;
      if (!aDate) return -1;
      if (!bDate) return 1;
      return new Date(bDate).getTime() - new Date(aDate).getTime();
    });
  }, [savedVariantIds, selectedVariantIds, variantCreatedAt]);

  const assignedIds = selectedVariantIds;

  const displayVariants = useMemo(() => {
    const filtered =
      activeTab === "Recent"
        ? allVariants.filter((v) => recentIds.includes(v.variantId))
        : allVariants.filter((v) => assignedIds.includes(v.variantId));

    return filtered.sort((a, b) => {
      if (a.isPendingRemoval !== b.isPendingRemoval)
        return a.isPendingRemoval ? 1 : -1;

      if (activeTab === "Assigned") {
        const getSortKey = (name: string) => name.split("-")[0];

        const nameCompare = getSortKey(a.itemName).localeCompare(
          getSortKey(b.itemName),
          undefined,
          { numeric: true, sensitivity: "base" },
        );
        if (nameCompare !== 0) return nameCompare;

        // Same sort key → fall back to full name, then createdAt
        const fullNameCompare = a.itemName.localeCompare(b.itemName, undefined, {
          numeric: true,
          sensitivity: "base",
        });
        if (fullNameCompare !== 0) return fullNameCompare;

        if (!a.createdAt && !b.createdAt) return 0;
        if (!a.createdAt) return -1;
        if (!b.createdAt) return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }

      // Recent tab: unsaved float to top, then newest createdAt first
      if (!a.createdAt && !b.createdAt) return 0;
      if (!a.createdAt) return -1;
      if (!b.createdAt) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [allVariants, activeTab, recentIds, assignedIds]);

  const openScanner = (mode: ScanMode) => {
    setScanMode(mode);
    setShowQRScanner(true);
  };

  const handleQRScan = (qr: string) => {
    const trimmed = qr.trim();
    const variant = allVariants.find((v) => v.qrCode === trimmed);

    if (scanMode === "add") {
      if (!variant) {
        toastError("Variant not found with this QR code");
        return;
      }
      if (!selectedVariantIds.includes(variant.variantId)) {
        onToggleVariant(variant.variantId);
        toastSuccess(`${variant.itemName} added`);
      } else {
        toastSuccess(`${variant.itemName} already selected`);
      }
    } else {
      if (!variant) {
        toastError("Variant not found with this QR code");
        return;
      }
      if (!selectedVariantIds.includes(variant.variantId)) {
        toastError(`${variant.itemName} is not assigned to this agent`);
        return;
      }
      // Toggle immediately and mark red until Save is clicked
      onToggleVariant(variant.variantId);
      setPendingRemovalIds((prev) => new Set(prev).add(variant.variantId));
    }
  };

  const handleDownloadPDF = useCallback(async () => {
    setGeneratingPDF(true);
    try {
      const pdfVariants: PDFVariant[] = await Promise.all(
        displayVariants
          .filter((v) => !v.isUnsaved)
          .map(async (v) => {
            const imageDataUrl = v.image ? await urlToDataUrl(v.image) : null;
            return {
              variantId: v.variantId,
              itemName: v.itemName,
              itemType: v.itemType,
              itemPrice: v.itemPrice,
              imageDataUrl,
              qrCode: v.qrCode,
              sizes: v.sizes,
            };
          }),
      );

      const now = new Date();
      const generatedAt = now.toLocaleDateString("en-IN", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      const blob = await pdf(
        <AssignedItemsPDF
          variants={pdfVariants}
          agentName={agentName}
          tabLabel={activeTab}
          generatedAt={generatedAt}
        />,
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `assigned-items-${agentName.replace(/\s+/g, "-")}-${activeTab.toLowerCase()}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error("Failed to generate PDF:", e);
      toastError("Failed to generate PDF");
    } finally {
      setGeneratingPDF(false);
    }
  }, [activeTab, displayVariants, agentName]);

  const displayCount = displayVariants.length;

  return (
    <>
      <div className="border-t border-gray-100 pt-6 mt-2">
        <div className="sticky top-0 z-10 bg-white pt-2 pb-3 -mt-2 mb-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2">
              <h3 className="text-lg font-black text-gray-900">Items</h3>
              <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-md">
                {selectedVariantIds.length}
              </span>
              {hasChanges && (
                <span className="text-xs font-bold text-amber-500 bg-amber-50 px-2 py-0.5 rounded-md">
                  Unsaved
                </span>
              )}
            </div>
            <button
              onClick={onSaveItems}
              disabled={savingItems || !hasChanges}
              className="flex items-center justify-center gap-1.5 px-6 py-3 bg-green-600 text-white rounded-md font-bold shadow-lg shadow-green-600/20 active:scale-95 transition-all disabled:opacity-50 min-w-[100px]"
            >
              {savingItems ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

        <div className="flex gap-2 items-center justify-center mb-3">
          <button
            onClick={() => openScanner("add")}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-white border border-gray-200 rounded-md hover:bg-gray-50 active:scale-[0.98] transition-all"
          >
            <Scan size={18} className="text-gray-600" />
            <span className="font-bold text-sm text-gray-700">Add</span>
          </button>
          <button
            onClick={() => openScanner("remove")}
            disabled={selectedVariantIds.length === 0}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-white border border-red-200 rounded-md hover:bg-red-50 active:scale-[0.98] transition-all disabled:opacity-40"
          >
            <ScanLine size={18} className="text-red-500" />
            <span className="font-bold text-sm text-red-500">Remove</span>
          </button>
          <button
            onClick={handleDownloadPDF}
            disabled={generatingPDF || displayCount === 0}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-white border border-gray-200 rounded-md hover:bg-gray-50 active:scale-[0.98] transition-all"
            title="Download PDF"
          >
            {generatingPDF ? (
              <span className="w-4 h-4 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin block" />
            ) : (
              <Download size={18} />
            )}
            <span className="text-sm font-bold text-gray-700">PDF</span>
          </button>
        </div>

        {selectedVariantIds.length > 0 && (
          <div className="flex items-center gap-2 mb-4">
            <div className="flex-1 bg-gray-100/50 p-1.5 flex items-center space-x-1 border border-gray-200 rounded-md">
              <button
                onClick={() => setActiveTab("Recent")}
                className={`flex-1 rounded-md py-2 font-bold text-xs transition-all ${
                  activeTab === "Recent"
                    ? "bg-primary text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Recent ({recentIds.length})
              </button>
              <button
                onClick={() => setActiveTab("Assigned")}
                className={`flex-1 rounded-md py-2 font-bold text-xs transition-all ${
                  activeTab === "Assigned"
                    ? "bg-primary text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Assigned ({assignedIds.length})
              </button>
            </div>
          </div>
        )}

        {displayCount > 0 ? (
          <div className="space-y-2">
            {displayVariants.map((variant) => (
              <div
                key={variant.variantId}
                className={`w-full flex items-center gap-3 p-2.5 rounded-md border-2 transition-colors ${
                  variant.isPendingRemoval
                    ? "border-red-200 bg-red-50"
                    : variant.isUnsaved
                      ? "border-amber-200 bg-amber-50"
                      : "border-gray-100 bg-white"
                }`}
              >
                <div className="w-10 h-10 rounded-md shrink-0 overflow-hidden ring-1 ring-gray-100">
                  {variant.image ? (
                    <ImagePreview src={variant.image} alt={variant.itemName} />
                  ) : (
                    <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                      <Package size={16} className="text-gray-300" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="font-bold text-gray-900 text-sm truncate">
                      {variant.itemName}
                    </p>
                    {variant.isPendingRemoval && (
                      <span className="shrink-0 text-[10px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded leading-none">
                        Removing
                      </span>
                    )}
                    {variant.isUnsaved && !variant.isPendingRemoval && (
                      <span className="shrink-0 text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded leading-none">
                        Unsaved
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 truncate">
                    Rs. {variant.itemPrice}
                    {variant.itemType && ` · ${variant.itemType}`}
                  </p>
                  {variant.sizes.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {variant.sizes.map((s) => (
                        <span
                          key={s.size}
                          className="text-[10px] font-bold text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded"
                        >
                          {s.size}:{s.stock}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center text-gray-400 py-8 text-sm">
            {activeTab === "Recent"
              ? "No recently added variants"
              : "No assigned variants"}
          </p>
        )}
      </div>

      <QRScanModal
        isOpen={showQRScanner}
        onClose={() => setShowQRScanner(false)}
        onScan={handleQRScan}
      />

      <div className="h-20" />
    </>
  );
}

export type { Tab };
