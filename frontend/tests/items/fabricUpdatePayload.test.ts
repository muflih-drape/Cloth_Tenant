import { describe, it, expect } from "vitest";
import { buildFabricUpdatePayload } from "@/lib/updateItem";
import type { EditableVariant } from "@/types/item";

const existing = (over: Partial<EditableVariant> = {}): EditableVariant => ({
  backendId: 7,
  localId: "a",
  stockMeters: "120.5",
  displayOrder: "Maroon",
  imageUrl: "https://cdn.example.com/maroon.jpg",
  newImage: null,
  imagePreview: null,
  ...over,
});

/** The backend uses negative ids for colours that only exist in local state. */
const fresh = (over: Partial<EditableVariant> = {}): EditableVariant => ({
  backendId: -1,
  localId: "b",
  stockMeters: "40",
  displayOrder: "Ivory",
  imageUrl: null,
  newImage: null,
  imagePreview: null,
  ...over,
});

const common = { name: "Cotton Lawn", description: "Light", price_per_meter: "180.00" };

describe("buildFabricUpdatePayload", () => {
  it("sends stock for an existing colour", () => {
    // The row shows the live warehouse count and edits it in place; it is
    // echoed on every save so a correction is applied through the fabric.
    const payload = buildFabricUpdatePayload(common, [existing()]);
    expect(payload.variants[0].stock_meters).toBe("120.5");
  });

  it("sends opening stock for a colour that does not exist yet", () => {
    const payload = buildFabricUpdatePayload(common, [fresh()]);
    expect(payload.variants[0].stock_meters).toBe("40");
    expect(payload.variants[0]).not.toHaveProperty("id");
  });

  it("defaults a new colour with no stock entered to zero", () => {
    const payload = buildFabricUpdatePayload(common, [fresh({ stockMeters: "" })]);
    expect(payload.variants[0].stock_meters).toBe("0");
  });

  it("sends every colour, including untouched ones", () => {
    // The API deletes any colour absent from the payload, so an unchanged
    // colour still has to be listed or it would silently disappear.
    const payload = buildFabricUpdatePayload(common, [
      existing(),
      existing({ backendId: 8, localId: "c", displayOrder: "Navy" }),
      fresh(),
    ]);
    expect(payload.variants).toHaveLength(3);
    expect(payload.variants.map((v) => v.id)).toEqual([7, 8, undefined]);
  });

  it("maps a blank colour label to null so the field can be cleared", () => {
    const payload = buildFabricUpdatePayload(common, [existing({ displayOrder: "  " })]);
    expect(payload.variants[0].display_order).toBeNull();
  });

  it("flags image removal only when the photo was dropped", () => {
    const removed = buildFabricUpdatePayload(common, [existing({ imageUrl: null })]);
    expect(removed.variants[0].remove_image).toBe(true);

    const kept = buildFabricUpdatePayload(common, [existing()]);
    expect(kept.variants[0]).not.toHaveProperty("remove_image");
  });

  it("sends a replacement image instead of a removal flag", () => {
    const file = new File(["x"], "ivory.png", { type: "image/png" });
    const payload = buildFabricUpdatePayload(common, [
      existing({ newImage: file, imagePreview: "blob:ivory" }),
    ]);
    expect(payload.variants[0].image).toBe(file);
    expect(payload.variants[0]).not.toHaveProperty("remove_image");
  });

  it("carries the fabric-level fields through unchanged", () => {
    const payload = buildFabricUpdatePayload(
      { name: "Rayon", price_per_meter: "95.50" },
      [existing()],
    );
    expect(payload.name).toBe("Rayon");
    expect(payload.price_per_meter).toBe("95.50");
    expect(payload.description).toBe("");
  });
});
