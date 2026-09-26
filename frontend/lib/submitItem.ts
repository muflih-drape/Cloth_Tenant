import { fabricApi } from "@/lib/api/item";
import { fabricToFormData } from "@/lib/form-utils";
import type { ColorVariant, FabricRequest, FabricVariantRequest } from "@/types/item";
import { toMeters } from "@/types/item";

/**
 * Build the create payload for a fabric.
 *
 * Each colour is one variant carrying its own opening metre stock -- there is no
 * size breakdown to expand, so a variant maps straight across.
 */
export function buildFabricPayload(
  common: { name: string; description?: string; price_per_meter: string },
  variants: ColorVariant[],
): FabricRequest {
  const variantPayload: FabricVariantRequest[] = variants.map((variant) => ({
    image: variant.image,
    display_order: variant.displayOrder || null,
    stock_meters: variant.stockMeters || "0",
  }));
  return {
    name: common.name,
    description: common.description || "",
    price_per_meter: common.price_per_meter,
    variants: variantPayload,
  };
}

export async function submitFabric(
  common: { name: string; description?: string; price_per_meter: string },
  variants: ColorVariant[],
): Promise<void> {
  await fabricApi.create(fabricToFormData(buildFabricPayload(common, variants)));
}

/** Reject a stock figure the warehouse cannot honour, before we bother the API. */
export function validateStockMetres(raw: string): string | null {
  const metres = toMeters(raw);
  if (metres < 0) return "Stock cannot be negative.";
  if (metres > 1_000_000) return "That looks too large. Check the number.";
  return null;
}

// ─── Error helpers ────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * DRF error shapes:
 *   { detail: "msg" }
 *   { non_field_errors: ["msg"] }
 *   { field: ["msg"] }
 *   ["msg"]
 */
export function parseErrorMessage(body: any): string {
  if (!body) return "Something went wrong. Please try again.";
  if (typeof body === "string") return body;
  if (Array.isArray(body)) return body.join(" ");

  if (typeof body === "object") {
    const obj = body as Record<string, any>;

    if (typeof obj.detail === "string") return obj.detail;

    if (Array.isArray(obj.non_field_errors))
      return (obj.non_field_errors as string[]).join(" ");

    const messages = Object.entries(obj).flatMap(([field, val]) => {
      const msgs = Array.isArray(val) ? val : [String(val)];
      return msgs.map((m) => `${field}: ${m}`);
    });
    if (messages.length) return messages.join("\n");
  }

  return "Something went wrong. Please try again.";
}
