"use client";

import { api } from "@/lib/api/axios";
import { itemApi } from "@/lib/api/item";
import type { EditCommonDetails, EditableVariant, ItemRequest } from "@/types/item";
import { parseErrorMessage } from "@/lib/submitItem";

export async function updateItem(
  itemId: number,
  common: EditCommonDetails,
  variants: EditableVariant[],
): Promise<void> {
  const payload: ItemRequest = {
    name: common.name,
    price: common.price,
    type: common.type,
    ...(common.description && { description: common.description }),
    variants: variants.map((v) => ({
      id: v.backendId || undefined,
      sizes: [{
        size: v.size,
        stock: v.stock,
      }],
      ...(v.newImage && { image: v.newImage }),
    })),
  };

  await itemApi.update(itemId, payload);

  const imageUpdates = variants.filter((v) => v.newImage);
  if (imageUpdates.length === 0) return;

  await Promise.all(
    imageUpdates.map((v) => {
      const fd = new FormData();
      fd.append("image", v.newImage!);
      return api.patch(`/api/items/variants/${v.backendId}/`, fd);
    }),
  );
}

export { parseErrorMessage };
