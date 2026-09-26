"use client";

import { useRef, useState } from "react";
import { ArrowLeft, ImagePlus, X } from "lucide-react";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import Image from "next/image";
import heic2any from "heic2any";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import CropModal from "./cropModal";
import CommonDetailsBadge from "./commonDetailsBadge";
import { ColorVariant, CommonDetails, FrontendSizeRange } from "@/types/item";
import { getSizesForItemType } from "@/types/item";
import { Modal, ModalButton } from "@/components/ui/custom/Modals";
import { normalizeImageFile } from "@/lib/image-utils";

interface Props {
  initial: ColorVariant;
  common: CommonDetails;
  isEdit: boolean;
  variantIndex: number; // for the "Variant #N" header label
  onSave: (v: ColorVariant) => void;
  onBack: () => void;
}

export default function Step2AddColor({
  initial,
  common,
  isEdit,
  variantIndex,
  onSave,
  onBack,
}: Props) {
  const availableSizes = getSizesForItemType(common.type, "item_creation");

  const [variant, setVariant] = useState<ColorVariant>(() => {
    if (common.type === "kids") {
      const fullyInitialized = availableSizes.reduce(
        (acc, size) => ({ ...acc, [size]: initial.perSizeStock?.[size] ?? 0 }),
        {} as Record<string, number>,
      );
      return { ...initial, perSizeStock: fullyInitialized };
    }
    return { ...initial};
  });
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [stockInput, setStockInput] = useState(String(initial.stock));

  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const [showPicker, setShowPicker] = useState(false);

  const isMobile =
    typeof window !== "undefined" &&
    /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  const set = <K extends keyof ColorVariant>(key: K, val: ColorVariant[K]) =>
    setVariant((v) => ({ ...v, [key]: val }));

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    const normalisedFile = await normalizeImageFile(f);

    setCropSrc(URL.createObjectURL(normalisedFile));
    e.target.value = "";
  };

  const handleCropDone = async (file: File) => {
    setVariant((v) => ({
      ...v,
      image: file,
      imagePreview: URL.createObjectURL(file),
      display_order: String(variantIndex)
    }));
    setCropSrc(null);
  };

  const handleStockChange = (raw: string) => {
    setStockInput(raw);
    const parsed = parseInt(raw, 10);
    set("stock", isNaN(parsed) ? 0 : parsed);
  };

  const handleStockBlur = () => {
    setStockInput(String(variant.stock));
  };

  const handlePickerOpen = () => {
    if (!isMobile) {
      galleryRef.current?.click();
    } else {
      setShowPicker(true);
    }
  };

  return (
    <>
      {cropSrc && (
        <CropModal
          src={cropSrc}
          onConfirm={handleCropDone}
          onCancel={() => setCropSrc(null)}
        />
      )}

      <div className="flex flex-col min-h-screen bg-white px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            type="button"
            onClick={onBack}
            className="p-2 -ml-2 rounded-full hover:bg-gray-50"
          >
            <ArrowLeft size={24} />
          </button>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-widest">
              {isEdit ? "Edit variant" : "Step 2 of 2"}
            </p>
            <h1 className="text-xl font-black leading-tight">
              Variant #{variantIndex}
            </h1>
          </div>
        </div>

        {/* Common details — read-only */}
        <CommonDetailsBadge common={common} />

        <div className="space-y-5 mt-6 flex-1">
          {/* Image */}
          <Field>
            <FieldLabel>Product Image</FieldLabel>
            <button
              type="button"
              onClick={handlePickerOpen}
              className="relative w-full rounded-2xl border-2 border-dashed border-gray-200 overflow-hidden flex items-center justify-center transition-colors hover:border-primary hover:bg-primary/5"
              style={{ height: variant.imagePreview ? 220 : 120 }}
            >
              {variant.imagePreview ? (
                <Image
                  src={variant.imagePreview}
                  fill
                  className="object-cover"
                  alt="preview"
                  unoptimized
                />
              ) : (
                <div className="flex flex-col items-center gap-2 py-8">
                  <ImagePlus size={26} className="text-gray-300" />
                  <span className="text-sm text-gray-400">
                    Tap to upload &amp; crop
                  </span>
                </div>
              )}
            </button>
            {variant.imagePreview && (
              <div className="flex gap-4 mt-2">
                <button
                  type="button"
                  onClick={handlePickerOpen}
                  className="text-xs text-primary font-medium"
                >
                  Change
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setVariant((v) => ({
                      ...v,
                      image: null,
                      imagePreview: null,
                    }))
                  }
                  className="text-xs text-red-400 flex items-center gap-1"
                >
                  <X size={11} /> Remove
                </button>
              </div>
            )}
          </Field>
          {/* Gallery */}
          <input
            ref={galleryRef}
            type="file"
            accept="image/*,.heic,.heif"
            className="hidden"
            onChange={handleFile}
          />

          {/* Camera */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*,.heic,.heif"
            capture="environment"
            className="hidden"
            onChange={handleFile}
          />

          {/* Size range — filtered by common.type */}
          {common.type === "kids" ? (
            <Field>
              <FieldLabel>Sizes & Stock</FieldLabel>
              <div className="space-y-2">
                {availableSizes.map((size) => {
                  const stockVal = variant.perSizeStock![size] ?? 0;

                  const updateStock = (raw: string) => {
                    const parsed = parseInt(raw, 10);
                    set("perSizeStock", {
                      ...variant.perSizeStock!,
                      [size]: isNaN(parsed) ? 0 : parsed,
                    });
                  };

                  return (
                    <div
                      key={size}
                      className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3"
                    >
                      <span className="text-sm font-semibold w-16 flex-shrink-0">
                        {size}
                      </span>
                      <div className="flex items-center gap-2 ml-auto">
                        <span className="text-xs text-gray-400">Stock</span>
                        <Input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={String(stockVal)}
                          placeholder="0"
                          onChange={(e) => updateStock(e.target.value)}
                          onFocus={(e) => e.target.select()}
                          className="w-20 text-center"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Field>
          ) : (
            /* Gents — unchanged */
            <>
              <Field>
                <FieldLabel>Size Range</FieldLabel>
                <Select
                  value={variant.sizeRange}
                  onValueChange={(v) =>
                    set("sizeRange", v as FrontendSizeRange)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSizes.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel>Stock per size</FieldLabel>
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={stockInput}
                  onChange={(e) => handleStockChange(e.target.value)}
                  onBlur={handleStockBlur}
                  onFocus={(e) => e.target.select()}
                />
              </Field>
            </>
          )}
        </div>

        {/* CTA */}
        <div className="mt-auto pt-8 pb-6">
          <StockFlowButton
            variant="filled"
            text={isEdit ? "Save Changes" : "Add Variant"}
            onClick={() => onSave(variant)}
            className="w-full h-14 rounded-2xl bg-primary text-white font-bold shadow-lg shadow-primary/20 flex items-center justify-center"
          />
        </div>
      </div>
      {showPicker && (
        <Modal
          icon={<ImagePlus className="text-black/20" />}
          iconBg="bg-yellow-100"
          title="Select Image Source"
          description="Choose how you want to add the product image."
          onClose={() => setShowPicker(false)}
          actions={
            <div className="flex gap-2 w-full">
              <ModalButton
                variant="ghost"
                onClick={() => {
                  setShowPicker(false);
                  cameraRef.current?.click();
                }}
              >
                Open Camera
              </ModalButton>

              <ModalButton
                variant="ghost"
                onClick={() => {
                  setShowPicker(false);
                  galleryRef.current?.click();
                }}
              >
                Choose from Gallery
              </ModalButton>
            </div>
          }
        />
      )}
    </>
  );
}
