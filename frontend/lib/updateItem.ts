import type { EditableVariant, FabricRequest } from "@/types/item";
import { fabricApi } from "./api/item";
import { fabricToFormData } from "./form-utils";

/**
 * Build the update payload for a fabric.
 *
 * Three rules the API relies on, all easy to get wrong:
 *  - Every colour has to be sent, because the API treats a colour missing from
 *    the payload as deleted.
 *  - `stock_meters` rides on every colour *except* one tracked by physical rolls.
 *    For an ordinary colour the row shows the live warehouse count and edits it
 *    in place; the API applies the edited figure and records the change on the
 *    stock cursor. For a roll-tracked colour the total is the sum of its rolls
 *    and is owned by the roll endpoints, so sending it would contradict them.
 *  - `is_roll_tracked` is sent so the backend can apply the rule above itself,
 *    whichever client is calling.
 */
export function buildFabricUpdatePayload(
  common: { name: string; description?: string; price_per_meter: string },
  variants: EditableVariant[],
): FabricRequest {
  return {
    name: common.name,
    description: common.description ?? "",
    price_per_meter: common.price_per_meter,
    variants: variants.map((variant) => {
      // Trim: a label of only spaces is an empty label, not the colour "  ".
      const label = variant.displayOrder.trim();
      const rollTracked = variant.backendId > 0 && variant.isRollTracked === true;
      return {
        // No id means "create this", which is how a just-added colour is sent.
        ...(variant.backendId > 0 ? { id: variant.backendId } : {}),
        display_order: label || null,
        ...(variant.newImage ? { image: variant.newImage } : {}),
        // A cleared photo is signalled by having no URL and no replacement.
        ...(variant.backendId > 0 && !variant.imageUrl && !variant.newImage
          ? { remove_image: true }
          : {}),
        ...(rollTracked
          ? { is_roll_tracked: true }
          : { stock_meters: variant.stockMeters || "0" }),
      };
    }),
  };
}

export async function updateFabric(
  fabricId: number,
  common: { name: string; description?: string; price_per_meter: string },
  variants: EditableVariant[],
): Promise<void> {
  // Multipart, not JSON: a replaced photo is a File, and JSON.stringify turns a
  // File into `{}`, which the API's FileField rejects with "The submitted data
  // was not a file."
  await fabricApi.update(
    fabricId,
    fabricToFormData(buildFabricUpdatePayload(common, variants)),
  );
}
