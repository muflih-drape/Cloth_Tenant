"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Package, Trash2, AlertCircle, Plus } from "lucide-react";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ImagePreview } from "@/components/pages/ImagePreview";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import { fabricApi } from "@/lib/api/item";
import { updateFabric } from "@/lib/updateItem";
import { toastError, toastSuccess } from "@/lib/toast";
import EditVariantRow from "./editVariantRow";
import CropModal from "../../new/cropModal";
import PhysicalRollsPanel from "@/components/items/physicalRollsPanel";
import type { EditableVariant, FabricDetails } from "@/types/item";
import { formatMeters, toMeters } from "@/types/item";
import { useAuth } from "@/context/AuthContext";
import PinDeleteDialog from "@/components/ui/pinDeleteDialog";
import { normalizeImageFile } from "@/lib/image-utils";
import { PageLoading } from "@/components/ui/Loading";

const uid = () => Math.random().toString(36).slice(2, 9);

const ALLOWED_IMAGE_EXT = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "avif",
  "bmp",
  "tiff",
  "tif",
  "heic",
  "heif",
];

export default function FabricEditPage() {
  const { isSuperuser } = useAuth();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const fabricId = Number(id);
  const nextTempId = useRef(-1);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    localId: string;
    label: string;
  } | null>(null);
  const [variantCrop, setVariantCrop] = useState<{
    src: string;
    localId: string;
  } | null>(null);

  const [common, setCommon] = useState<FabricDetails>({
    name: "",
    description: "",
    price_per_meter: "",
  });
  const [variants, setVariants] = useState<EditableVariant[]>([]);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // ── Fetch ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!fabricId) return;
    fabricApi
      .getOne(fabricId)
      .then((data) => {
        setCommon({
          name: data.name,
          description: data.description ?? "",
          price_per_meter: data.price_per_meter,
        });
        setVariants(
          data.variants.map((variant) => ({
            backendId: variant.id,
            localId: uid(),
            // The live warehouse count, shown in the row and sent back on save.
            stockMeters: variant.stock_meters,
            displayOrder: variant.display_order ?? "",
            imageUrl: variant.image ?? null,
            newImage: null,
            imagePreview: null,
            // A colour whose metres live on physical rolls: the figure above is
            // read-only and its only way to change is through the roll panel.
            isRollTracked: variant.is_roll_tracked ?? false,
            rollCount: variant.roll_count ?? 0,
          })),
        );
      })
      .catch((e) => toastError("Failed to load fabric", e))
      .finally(() => setLoading(false));
  }, [fabricId]);

  // ── Variant helpers ───────────────────────────────────────────────────────

  const updateVariant = (localId: string, updated: EditableVariant) =>
    setVariants((prev) =>
      prev.map((v) => (v.localId === localId ? updated : v)),
    );

  const deleteVariant = (localId: string) =>
    setVariants((prev) => prev.filter((v) => v.localId !== localId));

  const addVariant = () => {
    setVariants((prev) => [
      ...prev,
      {
        backendId: nextTempId.current--,
        localId: uid(),
        stockMeters: "0",
        displayOrder: "",
        imageUrl: null,
        newImage: null,
        imagePreview: null,
        // A colour being created has no rolls yet, so its opening figure is set
        // here in the ordinary way.
        isRollTracked: false,
        rollCount: 0,
      },
    ]);
  };

  /**
   * A roll received, cut or adjusted moves the colour's warehouse total, so the
   * read-only figure beside the colour has to follow it without a page reload.
   */
  const handleRollStockChanged = (localId: string, stockMeters: string) =>
    setVariants((prev) =>
      prev.map((v) =>
        v.localId === localId
          ? { ...v, stockMeters, isRollTracked: true }
          : v,
      ),
    );

  const handleVariantImageUpload = async (
    localId: string,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const f = e.target.files?.[0];
    if (!f) return;

    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_IMAGE_EXT.includes(ext)) {
      toastError("Invalid file type", `".${ext}" is not an allowed image format`);
      e.target.value = "";
      return;
    }

    const normalisedFile = await normalizeImageFile(f);
    setVariantCrop({ src: URL.createObjectURL(normalisedFile), localId });
    e.target.value = "";
  };

  const handleVariantCropConfirm = (localId: string, file: File) => {
    setVariants((prev) =>
      prev.map((v) =>
        v.localId === localId
          ? { ...v, newImage: file, imagePreview: URL.createObjectURL(file) }
          : v,
      ),
    );
    setVariantCrop(null);
  };

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateFabric(fabricId, common, variants);
      toastSuccess("Fabric updated");
      router.push("/admin/items");
    } catch (e) {
      toastError("Failed to update fabric", e);
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDeleteConfirm = async (pin: string) => {
    setDeleting(true);
    try {
      await fabricApi.remove(fabricId, pin);
      toastSuccess("Fabric deleted");
      router.push("/admin/items");
    } catch (e) {
      setDeleting(false);
      // Re-throw so PinDeleteDialog can show the error inside the dialog.
      throw e;
    }
  };

  const handleDelete = () => {
    if (isSuperuser) {
      if (!confirm("Delete this fabric? This cannot be undone.")) return;
      handleDeleteConfirm("");
      return;
    }
    setPinDialogOpen(true);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const rate = Number(common.price_per_meter);
  const isValid =
    common.name.trim() !== "" &&
    common.price_per_meter.trim() !== "" &&
    rate >= 0 &&
    variants.length > 0 &&
    variants.some((v) => v.displayOrder.trim() !== "" || v.newImage);

  if (loading) return <PageLoading />;

  const totalMetres = variants.reduce(
    (sum, v) => sum + toMeters(v.stockMeters),
    0,
  );
  const heroImage = variants[0]?.imagePreview ?? variants[0]?.imageUrl;

  return (
    <div className="w-full px-4 py-8 flex flex-col min-h-screen bg-white">
      <PinDeleteDialog
        open={pinDialogOpen}
        onClose={() => setPinDialogOpen(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Fabric"
        description="This fabric and all its colours will be removed."
      />

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-8">
          <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-xl space-y-4">
            <div className="space-y-1">
              <h3 className="text-base font-black">
                Remove {deleteConfirm.label}?
              </h3>
              <p className="text-sm text-gray-400">
                The colour and its {formatMeters(
                  variants.find((v) => v.localId === deleteConfirm.localId)
                    ?.stockMeters,
                )}{" "}
                m of stock will be removed. Existing order history is kept.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 h-11 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  deleteVariant(deleteConfirm.localId);
                  setDeleteConfirm(null);
                }}
                className="flex-1 h-11 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <button
          type="button"
          onClick={() => router.back()}
          className="p-2 -ml-2 rounded-full hover:bg-gray-50"
        >
          <ArrowLeft size={24} />
        </button>
        <div className="text-center flex-1">
          <h1 className="text-xl font-black">Edit Fabric</h1>
          <p className="text-[10px] text-gray-400 uppercase tracking-widest">
            ID #{id}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="p-2 rounded-xl text-red-400 hover:bg-red-50 transition-colors"
        >
          <Trash2 size={20} />
        </button>
      </div>

      {/* Hero */}
      <div className="flex flex-col items-center mb-8">
        <div className="relative w-20 h-20 bg-primary/10 rounded-3xl flex items-center justify-center mb-3 overflow-hidden">
          {heroImage ? (
            <ImagePreview src={heroImage} alt={common.name} />
          ) : (
            <Package size={36} className="text-primary" />
          )}
        </div>
        <h2 className="text-xl font-black">{common.name || "—"}</h2>
        <p className="text-sm text-gray-400 font-medium">
          {formatMeters(totalMetres)} m across {variants.length} colour
          {variants.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="space-y-4">
        {/* ── Fabric details ── */}
        <div className="bg-gray-50 border border-gray-100 rounded-2xl px-5 py-5 space-y-4">
          <p className="text-[10px] text-gray-400 uppercase tracking-widest">
            Fabric Details
          </p>

          <Field>
            <FieldLabel>Name *</FieldLabel>
            <Input
              value={common.name}
              onChange={(e) =>
                setCommon((p) => ({ ...p, name: e.target.value }))
              }
            />
          </Field>

          <Field>
            <FieldLabel>Description</FieldLabel>
            <Textarea
              value={common.description}
              onChange={(e) =>
                setCommon((p) => ({ ...p, description: e.target.value }))
              }
            />
          </Field>

          <Field>
            <FieldLabel>Price per metre (₹) *</FieldLabel>
            <Input
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={common.price_per_meter}
              onChange={(e) =>
                setCommon((p) => ({ ...p, price_per_meter: e.target.value }))
              }
            />
            {common.price_per_meter.trim() !== "" && rate < 0 && (
              <p className="mt-1.5 text-xs text-red-600">
                Enter a price of zero or more.
              </p>
            )}
          </Field>
        </div>

        {/* ── Colours ── */}
        <div>
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="font-bold text-sm">Colours</h2>
            <span className="text-[10px] text-gray-400 uppercase tracking-widest">
              {variants.length} colour{variants.length !== 1 ? "s" : ""}
            </span>
          </div>

          {variants.length === 0 && (
            <div className="flex items-center gap-2 text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs">
              <AlertCircle size={14} className="shrink-0" />
              At least one colour is required.
            </div>
          )}

          <div className="space-y-2">
            {variants.map((variant, index) => (
              <div key={variant.localId}>
                <input
                  ref={(el) => {
                    fileRefs.current[variant.localId] = el;
                  }}
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.gif,.avif,.bmp,.tiff,.tif,.svg"
                  className="hidden"
                  onChange={(e) =>
                    handleVariantImageUpload(variant.localId, e)
                  }
                />
                <EditVariantRow
                  variant={variant}
                  index={index}
                  isOnly={variants.length === 1}
                  isNew={variant.backendId < 0}
                  onChange={(updated) => updateVariant(variant.localId, updated)}
                  onDelete={() =>
                    setDeleteConfirm({
                      localId: variant.localId,
                      label: variant.displayOrder.trim() || `Colour #${index + 1}`,
                    })
                  }
                  onPickImage={() =>
                    fileRefs.current[variant.localId]?.click()
                  }
                />

                {/* Physical rolls: the only place a roll-tracked colour's
                    metre total can change, once it has rolls. */}
                {variant.backendId > 0 && (
                  <div className="mt-2">
                    <PhysicalRollsPanel
                      variantId={variant.backendId}
                      label={common.name || "Fabric"}
                      onStockChanged={(stock) =>
                        handleRollStockChanged(variant.localId, stock)
                      }
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addVariant}
            className="mt-3 w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 hover:border-primary hover:text-primary transition-colors"
          >
            <Plus size={16} />
            Add Colour
          </button>

          <p className="mt-3 text-[11px] text-gray-400 leading-relaxed">
            Colours are what orders are placed against, and a colour&apos;s metre
            count is its warehouse stock. Edit it here and it is saved with the
            fabric. A colour tracked by physical rolls shows its total read-only
            instead: that figure is the sum of its rolls, so it changes by
            receiving, packing or adjusting a roll.
          </p>

          {variantCrop && (
            <CropModal
              src={variantCrop.src}
              onConfirm={(file) =>
                handleVariantCropConfirm(variantCrop.localId, file)
              }
              onCancel={() => setVariantCrop(null)}
            />
          )}
        </div>
      </div>

      <div className="mt-8 mb-24">
        <StockFlowButton
          variant="filled"
          text={saving ? "Saving…" : "Save Changes"}
          disabled={!isValid || saving}
          onClick={handleSave}
          className="w-full h-14 rounded-2xl bg-primary text-white font-bold shadow-lg shadow-primary/20 flex items-center justify-center"
        />
      </div>
    </div>
  );
}
