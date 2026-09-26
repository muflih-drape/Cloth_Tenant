"use client";

import { useRef, useState } from "react";
import { ArrowLeft, ImagePlus, X } from "lucide-react";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import Image from "next/image";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import CropModal from "./cropModal";
import CommonDetailsBadge from "./commonDetailsBadge";
import { ColorVariant, FabricDetails } from "@/types/item";
import { formatMeters } from "@/types/item";
import { Modal, ModalButton } from "@/components/ui/custom/Modals";
import { normalizeImageFile } from "@/lib/image-utils";

interface Props {
  initial: ColorVariant;
  common: FabricDetails;
  isEdit: boolean;
  variantIndex: number; // for the "Colour #N" header label
  onSave: (v: ColorVariant) => void;
  onBack: () => void;
}

/**
 * One colour of a fabric. A colour *is* the stock-keeping unit here, so the
 * opening metre count entered on this screen is the physical cloth on hand for
 * that colour -- there is no size breakdown to fill in.
 */
export default function Step2AddColor({
  initial,
  common,
  isEdit,
  variantIndex,
  onSave,
  onBack,
}: Props) {
  const [variant, setVariant] = useState<ColorVariant>({ ...initial });
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [stockInput, setStockInput] = useState(initial.stockMeters || "0");
  const [stockError, setStockError] = useState<string | null>(null);

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
    }));
    setCropSrc(null);
  };

  const handleStockChange = (raw: string) => {
    setStockInput(raw);
    set("stockMeters", raw);
    if (stockError) setStockError(null);
  };

  const handleStockBlur = () => {
    const metres = Number(stockInput);
    if (stockInput === "" || Number.isNaN(metres) || metres < 0) {
      setStockError("Enter the metres on hand, zero or more.");
      setStockInput("0");
      set("stockMeters", "0");
    }
  };

  const handleSave = () => {
    const metres = Number(stockInput);
    if (stockInput === "" || Number.isNaN(metres) || metres < 0) {
      setStockError("Enter the metres on hand, zero or more.");
      return;
    }
    onSave({ ...variant, stockMeters: stockInput });
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
              {isEdit ? "Edit colour" : "Step 2 of 2"}
            </p>
            <h1 className="text-xl font-black leading-tight">
              Colour #{variantIndex}
            </h1>
          </div>
        </div>

        <CommonDetailsBadge common={common} />

        <div className="space-y-5 mt-6 flex-1">
          {/* Image */}
          <Field>
            <FieldLabel>Colour photo</FieldLabel>
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

          <input
            ref={galleryRef}
            type="file"
            accept="image/*,.heic,.heif"
            className="hidden"
            onChange={handleFile}
          />

          <input
            ref={cameraRef}
            type="file"
            accept="image/*,.heic,.heif"
            capture="environment"
            className="hidden"
            onChange={handleFile}
          />

          {/* Colour name — this is what the picker shows on the order screen */}
          <Field>
            <FieldLabel>Colour / finish</FieldLabel>
            <Input
              placeholder="e.g. Maroon, Ivory, Navy"
              value={variant.displayOrder}
              onChange={(e) => set("displayOrder", e.target.value)}
            />
          </Field>

          {/* Opening stock */}
          <Field>
            <FieldLabel>Opening stock (metres)</FieldLabel>
            <Input
              type="number"
              min={0}
              step="0.5"
              inputMode="decimal"
              value={stockInput}
              placeholder="0"
              onChange={(e) => handleStockChange(e.target.value)}
              onBlur={handleStockBlur}
              onFocus={(e) => e.target.select()}
            />
            {stockError ? (
              <p className="mt-1.5 text-xs text-red-600">{stockError}</p>
            ) : (
              <p className="mt-1.5 text-xs text-gray-400">
                {formatMeters(stockInput)} m of this colour on hand. You can
                change this later without touching the order history.
              </p>
            )}
          </Field>
        </div>

        {/* CTA */}
        <div className="mt-auto pt-8 pb-6">
          <StockFlowButton
            variant="filled"
            text={isEdit ? "Save Changes" : "Add Colour"}
            onClick={handleSave}
            className="w-full h-14 rounded-2xl bg-primary text-white font-bold shadow-lg shadow-primary/20 flex items-center justify-center"
          />
        </div>
      </div>

      {showPicker && (
        <Modal
          icon={<ImagePlus className="text-black/20" />}
          iconBg="bg-yellow-100"
          title="Select Image Source"
          description="Choose how you want to add the colour photo."
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
