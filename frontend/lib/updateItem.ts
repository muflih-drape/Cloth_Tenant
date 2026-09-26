import { EditableVariant, EditCommonDetails } from "@/types/item";
import { api } from "./api";
import { itemApi } from "./api/item";

export async function updateItem(
  itemId: number,
  common: EditCommonDetails,
  variants: EditableVariant[],
): Promise<void> {
  // ── Group all variants by backendId ───────────────────────────────────────
  // Positive backendId  → existing variant (send with id)
  // Negative backendId  → new variant added on edit page (send without id)

  type GroupEntry = {
    id?: number; // omitted for new variants
    isNew: boolean;
    sizes: { size: string; stock: number }[];
    newImage: File | null;
    imageRemoved: boolean;
    display_order?: string;
  };

  const grouped = variants.reduce<Record<string, GroupEntry>>((acc, v) => {
    const key = String(v.backendId);
    if (!acc[key]) {
      acc[key] = {
        ...(v.backendId > 0 ? { id: v.backendId } : {}), // no id for new
        isNew: v.backendId < 0,
        sizes: [],
        newImage: v.newImage,
        imageRemoved:
          v.imageUrl === null && v.newImage === null && v.backendId > 0,
        display_order: v.display_order,
      };
    }
    acc[key].sizes.push({ size: v.size, stock: v.stock });
    return acc;
  }, {});

  // ── Build PATCH payload ───────────────────────────────────────────────────
  const payload = {
    name: common.name,
    price: common.price,
    type: common.type,
    ...(common.description && { description: common.description }),
    variants: Object.values(grouped).map((g) => ({
      ...(g.id ? { id: g.id } : {}), // existing variants carry their id
      sizes: g.sizes,
      ...(g.imageRemoved ? { remove_image: true } : {}),
      ...(g.display_order !== undefined ? { display_order: g.display_order === "" ? null : g.display_order } : {}),
    })),
  };

  const updatedItem = await itemApi.update(itemId, payload);

  // ── Upload images ─────────────────────────────────────────────────────────
  // Collect image jobs: existing variants with a new image + newly created variants
  const imageJobs: { variantId: number; image: File }[] = [];

  // 1. Existing variants that got a new image
  Object.values(grouped)
    .filter((g) => !g.isNew && g.newImage)
    .forEach((g) => {
      imageJobs.push({ variantId: g.id!, image: g.newImage! });
    });

  // 2. New variants that have an image — match them by position in the response
  //    The backend returns variants in insertion order; new ones are appended.
  const newGroups = Object.values(grouped).filter((g) => g.isNew && g.newImage);
  if (newGroups.length > 0 && updatedItem?.variants) {
    // Existing variant ids we already know about
    const existingIds = new Set(
      Object.values(grouped)
        .filter((g) => !g.isNew)
        .map((g) => g.id),
    );
    // The remaining variants in the response are the newly created ones
    const createdVariants = updatedItem.variants.filter(
      (v: { id: number }) => !existingIds.has(v.id),
    );
    newGroups.forEach((g, i) => {
      if (createdVariants[i]) {
        imageJobs.push({
          variantId: createdVariants[i].id,
          image: g.newImage!,
        });
      }
    });
  }

  if (imageJobs.length === 0) return;

  await Promise.all(
    imageJobs.map(({ variantId, image }) => {
      const fd = new FormData();
      fd.append("image", image);
      return api.patch(`/api/items/variants/${variantId}/`, fd);
    }),
  );
}
