"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Step1CommonDetails from "./commonDetails";
import Step2AddColor from "./addColor";
import ColorListScreen from "./colorList";
import { submitFabric } from "@/lib/submitItem";
import type { ColorVariant, FabricDetails, WizardStep } from "@/types/item";
import { toastError, toastWarning } from "@/lib/toast";

const uid = () => Math.random().toString(36).slice(2, 9);

function blankVariant(): ColorVariant {
  return {
    id: uid(),
    stockMeters: "0",
    displayOrder: "",
    image: null,
    imagePreview: null,
  };
}

export default function NewItemPage() {
  const router = useRouter();

  const [common, setCommon] = useState<FabricDetails>({
    name: "",
    description: "",
    price_per_meter: "",
  });

  const [variants, setVariants] = useState<ColorVariant[]>([]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<WizardStep>({ screen: "common" });
  const [draft, setDraft] = useState<ColorVariant | null>(null);

  // ── Transitions ───────────────────────────────────────────────────────────

  const goCommonNext = () => {
    if (variants.length > 0) {
      setStep({ screen: "list" });
    } else {
      setDraft(blankVariant());
      setStep({ screen: "add-color" });
    }
  };

  const startAddColor = () => {
    setDraft(blankVariant());
    setStep({ screen: "add-color" });
  };

  const startEditColor = (id: string) => {
    const existing = variants.find((v) => v.id === id);
    if (!existing) return;
    setDraft({ ...existing });
    setStep({ screen: "add-color", editingId: id });
  };

  const backFromColorForm = () => {
    setDraft(null);
    setStep(variants.length > 0 ? { screen: "list" } : { screen: "common" });
  };

  // ── CRUD ──────────────────────────────────────────────────────────────────

  const saveColor = (saved: ColorVariant) => {
    const editingId = step.screen === "add-color" ? step.editingId : undefined;

    setVariants((prev) =>
      editingId
        ? prev.map((v) =>
            v.id === editingId ? { ...saved, id: editingId } : v,
          )
        : [...prev, saved],
    );
    setDraft(null);
    setStep({ screen: "list" });
  };

  const deleteColor = (id: string) =>
    setVariants((prev) => prev.filter((x) => x.id !== id));

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const totalBytes = variants.reduce(
        (sum, v) => sum + (v.image ? v.image.size : 0),
        0,
      );
      if (totalBytes >= 20 * 1024 * 1024) {
        toastWarning(
          "Large upload detected",
          "You have uploaded more than 20MB of images. The server may reject this. Consider using smaller photos.",
        );
      }
      await submitFabric(common, variants);
      router.push("/admin/items");
    } catch (err) {
      toastError("Failed to create fabric", err);
      setLoading(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (step.screen === "common") {
    return (
      <Step1CommonDetails
        value={common}
        onChange={setCommon}
        onNext={goCommonNext}
        onBack={() => router.back()}
      />
    );
  }

  if (step.screen === "add-color" && draft) {
    const editingId = step.editingId;
    const variantIndex = editingId
      ? variants.findIndex((v) => v.id === editingId) + 1
      : variants.length + 1;

    return (
      <Step2AddColor
        initial={draft}
        common={common}
        isEdit={!!editingId}
        variantIndex={variantIndex}
        onSave={saveColor}
        onBack={backFromColorForm}
      />
    );
  }

  return (
    <div className="flex flex-col">
      <ColorListScreen
        common={common}
        variants={variants}
        loading={loading}
        onEditCommon={() => setStep({ screen: "common" })}
        onAddColor={startAddColor}
        onEditColor={startEditColor}
        onDeleteColor={deleteColor}
        onSubmit={handleSubmit}
        onBack={() => setStep({ screen: "common" })}
      />
    </div>
  );
}
