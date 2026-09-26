"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { transportApi } from "@/lib/api/transport";
import { toastSuccess, toastError } from "@/lib/toast";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import { ArrowLeft } from "lucide-react";

export default function NewTransportPage() {
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const router = useRouter();

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Transport name is required";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      await transportApi.create({ name, is_active: isActive });
      toastSuccess("Transport created successfully");
      router.push("/admin/settings");
    } catch (error) {
      console.error("Error creating transport:", error);
      toastError("Failed to create transport");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full px-4 py-8 flex flex-col min-h-screen bg-white">
      <div className="mb-8">
        <button
          onClick={() => router.back()}
          className="mb-4 p-2 -ml-2 rounded-xl hover:bg-gray-50 text-gray-400 transition-colors"
        >
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-2xl font-black text-gray-900 tracking-tight">
          New Transport
        </h1>
        <p className="text-sm text-gray-400 font-medium">
          Add a new transport company
        </p>
      </div>

      <div className="bg-gray-50/50 border border-gray-100 rounded-3xl p-6 mb-8">
        <FieldGroup className="space-y-6">
          <Field>
            <div className="flex justify-between items-center mb-1.5">
              <FieldLabel className="text-xs font-bold uppercase tracking-widest text-gray-400">
                Transport Name
              </FieldLabel>
              {errors.name && (
                <span className="text-[10px] text-red-500 font-bold">
                  {errors.name}
                </span>
              )}
            </div>
            <Input
              placeholder="e.g. DHL, KPS, Delhivery"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`bg-white border-gray-100 rounded-xl h-12 focus:ring-primary/10 ${errors.name ? "border-red-200 focus:border-red-300" : "focus:border-primary"}`}
            />
          </Field>

          <Field>
            <div className="flex justify-between items-center mb-1.5">
              <FieldLabel className="text-xs font-bold uppercase tracking-widest text-gray-400">
                Status
              </FieldLabel>
            </div>
            <button
              type="button"
              onClick={() => setIsActive(!isActive)}
              className={`w-full px-4 py-3 rounded-xl border font-bold text-sm transition-all ${
                isActive
                  ? "bg-green-50 border-green-200 text-green-700"
                  : "bg-gray-50 border-gray-200 text-gray-400"
              }`}
            >
              {isActive ? "Active" : "Inactive"}
            </button>
          </Field>
        </FieldGroup>
      </div>

      <div className="flex gap-4 items-center mt-auto pb-10">
        <StockFlowButton
          variant="outline"
          text="Cancel"
          onClick={() => router.back()}
          className="flex-1 h-14 rounded-2xl border-gray-200 font-bold text-gray-500 active:scale-95 transition-all text-sm"
        />

        <StockFlowButton
          variant="filled"
          text={isSubmitting ? "Creating..." : "Add Transport"}
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="flex-[2] h-14 rounded-2xl bg-primary shadow-lg shadow-primary/20 font-bold text-white active:scale-95 transition-all text-sm"
        />
      </div>
    </div>
  );
}
