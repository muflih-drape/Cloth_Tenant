"use client";

import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import { ArrowLeft } from "lucide-react";
import type { FabricDetails } from "@/types/item";

interface Props {
  value: FabricDetails;
  onChange: (v: FabricDetails) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function Step1CommonDetails({ value, onChange, onNext, onBack }: Props) {
  const set = <K extends keyof FabricDetails>(key: K, val: FabricDetails[K]) =>
    onChange({ ...value, [key]: val });

  const rate = Number(value.price_per_meter);
  const priceValid = value.price_per_meter.trim() !== "" && rate >= 0;
  const isValid = value.name.trim() !== "" && priceValid;

  return (
    <div className="flex flex-col min-h-screen bg-white px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <button
          type="button"
          onClick={onBack}
          className="p-2 -ml-2 rounded-full hover:bg-gray-50"
        >
          <ArrowLeft size={24} />
        </button>
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-widest">
            Step 1 of 2
          </p>
          <h1 className="text-xl font-black leading-tight">Fabric Details</h1>
        </div>
      </div>

      <p className="text-sm text-gray-400 mb-6 leading-relaxed">
        These details are shared across all the colours you&apos;ll add next.
      </p>

      <div className="space-y-5 flex-1">
        <Field>
          <FieldLabel>Fabric name *</FieldLabel>
          <Input
            placeholder="e.g. Cotton Lawn, Rayon Cambric"
            value={value.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel>Description</FieldLabel>
          <Textarea
            placeholder="Composition, weight, feel…"
            value={value.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel>Price per metre (₹) *</FieldLabel>
          <Input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            placeholder="0.00"
            value={value.price_per_meter}
            onChange={(e) => set("price_per_meter", e.target.value)}
          />
          {value.price_per_meter.trim() !== "" && !priceValid && (
            <p className="mt-1.5 text-xs text-red-600">
              Enter a price of zero or more.
            </p>
          )}
        </Field>
      </div>

      <div className="mt-auto pt-8 pb-6">
        <StockFlowButton
          variant="filled"
          text="Next — Add Colours"
          disabled={!isValid}
          onClick={onNext}
          className="w-full h-14 rounded-2xl bg-primary text-white font-bold shadow-lg shadow-primary/20 flex items-center justify-center"
        />
      </div>
    </div>
  );
}
