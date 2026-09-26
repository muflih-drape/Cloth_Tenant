"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import Step2AddColor from "../../new/addColor";
import type { ColorVariant } from "@/types/item";
import { getSizesForItemType, SIZE_RANGE_TO_SIZES } from "@/types/item";
import { Plus } from "lucide-react";

import {
  ArrowLeft,
  Package,
  Trash2,
  AlertCircle,
  ImagePlus,
  ChevronDown,
} from "lucide-react";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
} from "@/components/ui/accordion";
import Image from "next/image";
import { ImagePreview } from "@/components/pages/ImagePreview";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import { itemApi } from "@/lib/api/item";
import { updateItem } from "@/lib/updateItem";
import { toastError, toastSuccess } from "@/lib/toast";
import EditVariantRow, { DisplayOrderField } from "./editVariantRow";
import CropModal from "../../new/cropModal";
import type {
  EditCommonDetails,
  EditableVariant,
  ItemType,
  FrontendSizeRange,
} from "@/types/item";
import { useAuth } from "@/context/AuthContext";
import PinDeleteDialog from "@/components/ui/pinDeleteDialog";
import { normalizeImageFile } from "@/lib/image-utils";
import { PageLoading } from "@/components/ui/Loading";

const uid = () => Math.random().toString(36).slice(2, 9);

export default function ItemEditPage() {
  const { isSuperuser } = useAuth();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const nextTempId = useRef(-1);

  const [addingVariant, setAddingVariant] = useState(false);
  const [variantDraft, setVariantDraft] = useState<ColorVariant | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);

  const [common, setCommon] = useState<EditCommonDetails>({
    name: "",
    description: "",
    price: "",
    type: "gents",
  });

  const [variants, setVariants] = useState<EditableVariant[]>([]);
  const [openAccordions, setOpenAccordions] = useState<string[]>([]);
  const [variantCrop, setVariantCrop] = useState<{
    src: string;
    backendId: number;
  } | null>(null);
  const fileRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const [deleteConfirm, setDeleteConfirm] = useState<{
    backendId: number;
    label: string;
  } | null>(null);

  const confirmDeleteVariantGroup = (backendId: number, label: string) => {
    setDeleteConfirm({ backendId, label });
  };

  const handleDeleteConfirmedVariant = () => {
    if (!deleteConfirm) return;
    deleteVariantGroup(deleteConfirm.backendId);
    setDeleteConfirm(null);
  };

  function blankVariant(): ColorVariant {
    return {
      id: String(nextTempId.current--),
      sizeRange: getSizesForItemType(common.type, "item_creation")[0],
      stock: 0,
      image: null,
      perSizeStock: {},
      imagePreview: null,
    };
  }

  const startAddVariant = () => {
    setVariantDraft(blankVariant());
    setAddingVariant(true);
  };

  const saveNewVariant = (saved: ColorVariant) => {
    const tempBackendId = nextTempId.current--;

    let sizeStockPairs: { size: string; stock: number }[] = [];

    if (common.type === "kids") {
      (Object.keys(saved.perSizeStock) as FrontendSizeRange[]).forEach(
        (rangeKey) => {
          const stock =
            (saved.perSizeStock as Record<string, number>)[rangeKey] ?? 0;
          const expandedSizes = SIZE_RANGE_TO_SIZES[rangeKey] ?? [rangeKey];
          expandedSizes.forEach((size) => {
            sizeStockPairs.push({ size, stock });
          });
        },
      );
    } else {
      const sizes = SIZE_RANGE_TO_SIZES[saved.sizeRange] ?? [];
      sizeStockPairs = sizes.map((size) => ({
        size,
        stock: saved.stock,
      }));
    }

    const newRows: EditableVariant[] = sizeStockPairs.map(
      ({ size, stock }) => ({
        backendId: tempBackendId,
        localId: uid(),
        size,
        stock,
        imageUrl: null,
        newImage: saved.image,
        imagePreview: saved.imagePreview,
        display_order: saved.display_order ?? "",
      }),
    );

    setVariants((prev) => [...prev, ...newRows]);
    setAddingVariant(false);
    setVariantDraft(null);
  };

  // ── Group variants by backendId ───────────────────────────────────────────

  const variantGroups = useMemo(() => {
    const groups: Record<
      number,
      {
        backendId: number;
        imageUrl: string | null;
        newImage: File | null;
        imagePreview: string | null;
        display_order: string | undefined;
        sizes: EditableVariant[];
      }
    > = {};

    variants.forEach((v) => {
      if (!groups[v.backendId]) {
        groups[v.backendId] = {
          backendId: v.backendId,
          imageUrl: v.imageUrl,
          newImage: v.newImage,
          imagePreview: v.imagePreview,
          display_order: v.display_order,
          sizes: [],
        };
      }
      groups[v.backendId].sizes.push(v);
    });

    return Object.values(groups);
  }, [variants]);

  // ── Variant group helpers ─────────────────────────────────────────────────

  const updateVariantGroup = (
    backendId: number,
    updates: Partial<EditableVariant>,
  ) => {
    setVariants((prev) =>
      prev.map((v) => (v.backendId === backendId ? { ...v, ...updates } : v)),
    );
  };

  const deleteVariantGroup = (backendId: number) => {
    setVariants((prev) => prev.filter((v) => v.backendId !== backendId));
  };

  const handleVariantImageUpload = async (
    backendId: number,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const f = e.target.files?.[0];
    if (!f) return;

    const allowed = [
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
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!allowed.includes(ext)) {
      toastError(
        "Invalid file type",
        `".${ext}" is not an allowed image format`,
      );
      e.target.value = "";
      return;
    }

    const normalisedFile = await normalizeImageFile(f);

    setVariantCrop({ src: URL.createObjectURL(normalisedFile), backendId });
    e.target.value = "";
  };

  const handleVariantCropConfirm = async (backendId: number, file: File) => {
    updateVariantGroup(backendId, {
      newImage: file,
      imagePreview: URL.createObjectURL(file),
    });
    setVariantCrop(null);
  };

  // ── Fetch ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return;
    itemApi
      .getOne(Number(id))
      .then((data) => {
        setCommon({
          name: data.name,
          description: data.description ?? "",
          price: data.price,
          type: (data.type as ItemType) ?? "gents",
        });
        setVariants(
          data.variants.flatMap((v) =>
            v.sizes.map((s) => ({
              backendId: v.id,
              localId: uid(),
              size: (
                s as unknown as { id: number; size: string; stock: number }
              ).size,
              stock: s.stock,
              imageUrl: v.image ?? null,
              newImage: null,
              imagePreview: null,
              display_order: v.display_order !== null && v.display_order !== undefined ? String(v.display_order) : "",
            })),
          ),
        );
      })
      .catch((e) => toastError("Failed to load item", e))
      .finally(() => setLoading(false));
  }, [id]);

  // ── Variant helpers ───────────────────────────────────────────────────────

  const updateVariant = (localId: string, updated: EditableVariant) =>
    setVariants((prev) =>
      prev.map((v) => (v.localId === localId ? updated : v)),
    );

  const deleteVariant = (localId: string) =>
    setVariants((prev) => prev.filter((v) => v.localId !== localId));

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateItem(Number(id), common, variants);
      toastSuccess("Item updated successfully");
      router.push("/admin/items");
    } catch (e: any) {
      toastError("Failed to update item", e);
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = () => {
    if (isSuperuser) {
      if (!confirm("Delete this item? This cannot be undone.")) return;
      handleDeleteConfirm("");
      return;
    }
    setPinDialogOpen(true);
  };

  const handleDeleteConfirm = async (pin: string) => {
    setDeleting(true);
    try {
      await itemApi.delete(Number(id), pin);
      toastSuccess("Item deleted successfully");
      router.push("/admin/items");
    } catch (e: any) {
      setDeleting(false);
      // Re-throw so PinDeleteDialog can catch it and show the error inside the dialog
      throw e;
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const isValid =
    common.name.trim() !== "" &&
    common.price.trim() !== "" &&
    variants.length > 0;

  if (addingVariant && variantDraft) {
    return (
      <Step2AddColor
        initial={variantDraft}
        common={{ ...common, brand_id: undefined }}
        isEdit={false}
        variantIndex={variantGroups.length + 1}
        onSave={saveNewVariant}
        onBack={() => {
          setAddingVariant(false);
          setVariantDraft(null);
        }}
      />
    );
  }

  if (loading) {
    return <PageLoading />;
  }

  return (
    <div className="w-full px-4 py-8 flex flex-col min-h-screen bg-white">
      <PinDeleteDialog
        open={pinDialogOpen}
        onClose={() => setPinDialogOpen(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Item"
        description="This item and all its variants will be removed."
      />
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-8">
          <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-xl space-y-4">
            <div className="space-y-1">
              <h3 className="text-base font-black">
                Remove {deleteConfirm.label}?
              </h3>
              <p className="text-sm text-gray-400">
                This variant and all its sizes will be removed. This cannot be
                undone after saving.
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
                  deleteVariantGroup(deleteConfirm.backendId);
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
          <h1 className="text-xl font-black">Edit Item</h1>
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

      {/* Avatar */}
      <div className="flex flex-col items-center mb-8">
        <div className="relative w-20 h-20 bg-primary/10 rounded-3xl flex items-center justify-center mb-3 overflow-hidden">
          {(variantGroups[0]?.imagePreview ?? variantGroups[0]?.imageUrl) ? (
            <ImagePreview
              src={variantGroups[0].imagePreview ?? variantGroups[0].imageUrl!}
              alt={common.name}
            />
          ) : (
            <Package size={36} className="text-primary" />
          )}
        </div>
        <h2 className="text-xl font-black">{common.name || "—"}</h2>
      </div>

      <div className="space-y-4">
        {/* ── Common Details ── */}
        <div className="bg-gray-50 border border-gray-100 rounded-2xl px-5 py-5 space-y-4">
          <p className="text-[10px] text-gray-400 uppercase tracking-widest">
            Item Details
          </p>

          <Field>
            <FieldLabel>Name *</FieldLabel>
            <Input
              value={common.name}
              onChange={(e) =>
                setCommon((p) => ({
                  ...p,
                  name: e.target.value,
                }))
              }
            />
          </Field>

          <Field>
            <FieldLabel>Description</FieldLabel>
            <Textarea
              value={common.description}
              onChange={(e) =>
                setCommon((p) => ({
                  ...p,
                  description: e.target.value,
                }))
              }
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel>Price (₹) *</FieldLabel>
              <Input
                type="number"
                min={0}
                value={common.price}
                onChange={(e) =>
                  setCommon((p) => ({
                    ...p,
                    price: e.target.value,
                  }))
                }
              />
            </Field>

            <Field>
              <FieldLabel>Type</FieldLabel>
              <div className="h-12 px-3 flex items-center bg-gray-50 border border-gray-100 rounded-xl text-sm font-medium text-gray-500 capitalize">
                {common.type}
              </div>
            </Field>
          </div>
        </div>

        {/* ── Variants ── */}
        <div>
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="font-bold text-sm">Variants</h2>
            <span className="text-[10px] text-gray-400 uppercase tracking-widest">
              {variantGroups.length} variant
              {variantGroups.length !== 1 ? "s" : ""}, {variants.length} size
              {variants.length !== 1 ? "s" : ""}
            </span>
          </div>

          {variantGroups.length === 0 && (
            <div className="flex items-center gap-2 text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs">
              <AlertCircle size={14} className="shrink-0" />
              At least one variant is required.
            </div>
          )}

          <Accordion
            type="multiple"
            value={openAccordions}
            onValueChange={(values) => setOpenAccordions(values)}
            className="space-y-2"
          >
            {variantGroups.map((group, index) => {
              const currentImage = group.imagePreview ?? group.imageUrl;
              const variantLabel = `Variant #${group.display_order != "" ? group.display_order : index + 1}`;
              return (
                <AccordionItem
                  key={group.backendId}
                  value={String(group.backendId)}
                  className="bg-white border border-gray-300 rounded-md overflow-hidden shadow-sm"
                >
                  {/* Plain div — toggles accordion manually, no button nesting */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    {/* Thumbnail — triggers file input */}
                    <div
                      onClick={() => fileRefs.current[group.backendId]?.click()}
                      className="shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-gray-100
                                                       flex items-center justify-center group relative cursor-pointer"
                    >
                      {currentImage ? (
                        <>
                          <Image
                            src={currentImage}
                            fill
                            className="object-cover"
                            alt=""
                            unoptimized
                          />
                          <div
                            className="absolute inset-0 bg-black/0 group-hover:bg-black/20
                                                                    transition-colors flex items-center justify-center"
                          >
                            <ImagePlus
                              size={12}
                              className="text-white opacity-0 group-hover:opacity-100 transition-opacity"
                            />
                          </div>
                        </>
                      ) : (
                        <ImagePlus size={14} className="text-gray-300" />
                      )}
                    </div>

                    <input
                      ref={(el) => {
                        fileRefs.current[group.backendId] = el;
                      }}
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp,.gif,.avif,.bmp,.tiff,.tif,.svg"
                      className="hidden"
                      onChange={(e) =>
                        handleVariantImageUpload(group.backendId, e)
                      }
                    />

                    {/* Label — clicking this area toggles open/close */}
                    <div
                      className="flex-1 cursor-pointer select-none"
                      onClick={() =>
                        setOpenAccordions((prev) =>
                          prev.includes(String(group.backendId))
                            ? prev.filter((v) => v !== String(group.backendId))
                            : [...prev, String(group.backendId)],
                        )
                      }
                    >
                      <p className="text-sm font-semibold">{variantLabel}</p>
                      <p className="text-xs text-gray-400">
                        {group.sizes.length} size
                        {group.sizes.length !== 1 ? "s" : ""}
                      </p>
                    </div>

                    {/* Chevron — also toggles */}
                    <div
                      className="cursor-pointer text-gray-400 transition-transform duration-200"
                      style={{
                        transform: openAccordions.includes(
                          String(group.backendId),
                        )
                          ? "rotate(180deg)"
                          : "rotate(0deg)",
                      }}
                      onClick={() =>
                        setOpenAccordions((prev) =>
                          prev.includes(String(group.backendId))
                            ? prev.filter((v) => v !== String(group.backendId))
                            : [...prev, String(group.backendId)],
                        )
                      }
                    >
                      <ChevronDown size={16} />
                    </div>

                    {/* Remove image */}
                    {currentImage && (
                      <button
                        type="button"
                        onClick={() =>
                          fileRefs.current[group.backendId]?.click()
                        }
                        className="shrink-0 p-2 rounded-md text-blue-400 hover:text-white hover:bg-blue-400 transition-colors"
                        title="Replace image"
                      >
                        <ImagePlus size={16} />
                      </button>
                    )}

                    {/* Delete variant group */}
                    {variantGroups.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setDeleteConfirm({
                            backendId: group.backendId,
                            label: variantLabel,
                          })
                        }
                        className="shrink-0 p-2 rounded-md text-red-400 hover:text-white hover:bg-red-400 transition-colors"
                        aria-label="Delete variant"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>

                  <AccordionContent className="px-4 pb-3 space-y-2">
                    <div className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 mb-2">
                      <span className="text-xs text-gray-400 flex-shrink-0">Display Order</span>
                      <DisplayOrderField
                        value={group.display_order ?? ""}
                        placeholder="0"
                        onChange={(v) => updateVariantGroup(group.backendId, { display_order: v })}
                      />
                    </div>
                    {group.sizes.map((v) => (
                      <EditVariantRow
                        key={v.localId}
                        variant={v}
                        isOnly={group.sizes.length === 1}
                        onChange={(updated) =>
                          updateVariant(v.localId, updated)
                        }
                        onDelete={() => deleteVariant(v.localId)}
                      />
                    ))}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
          <button
            type="button"
            onClick={startAddVariant}
            className="mt-3 w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 hover:border-primary hover:text-primary transition-colors"
          >
            <Plus size={16} />
            Add Variant
          </button>

          {/* Variant Crop Modal */}
          {variantCrop && (
            <CropModal
              src={variantCrop.src}
              onConfirm={(file) =>
                handleVariantCropConfirm(variantCrop.backendId, file)
              }
              onCancel={() => setVariantCrop(null)}
            />
          )}
        </div>
      </div>

      {/* Save */}
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
