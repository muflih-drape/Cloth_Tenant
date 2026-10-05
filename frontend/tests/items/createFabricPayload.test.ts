import { describe, it, expect } from "vitest";
import { buildFabricPayload } from "@/lib/submitItem";
import { fabricToFormData } from "@/lib/form-utils";
import type { ColorVariant } from "@/types/item";

const common = {
  name: "Cotton Lawn",
  description: "Light lawn",
  price_per_meter: "180.00",
};

const colour = (over: Partial<ColorVariant> = {}): ColorVariant => ({
  id: "a",
  stockMeters: "1000",
  displayOrder: "Natural",
  image: null,
  imagePreview: null,
  ...over,
});

describe("buildFabricPayload", () => {
  it("sends the opening figure for a colour with no rolls", () => {
    // Unchanged behaviour: no rolls key at all, so the API applies the figure
    // directly and leaves the colour roll-less.
    const payload = buildFabricPayload(common, [colour()]);
    expect(payload.variants[0].stock_meters).toBe("1000");
    expect(payload.variants[0]).not.toHaveProperty("rolls");
  });

  it("sends the rolls alongside the opening figure", () => {
    // The figure is still sent, because it is the same field for a roll-less
    // colour. The API adds the two together and records the figure as a roll of
    // its own, so both count.
    const payload = buildFabricPayload(common, [
      colour({ rolls: [{ meters: "500" }, { meters: "450" }] }),
    ]);
    expect(payload.variants[0].stock_meters).toBe("1000");
    expect(payload.variants[0].rolls).toEqual([
      { meters: "500" },
      { meters: "450" },
    ]);
  });

  it("leaves out an empty roll list so the colour stays roll-less", () => {
    const payload = buildFabricPayload(common, [colour({ rolls: [] })]);
    expect(payload.variants[0]).not.toHaveProperty("rolls");
  });

  it("leaves out rolls that were cleared on the form", () => {
    const payload = buildFabricPayload(common, [colour({ rolls: undefined })]);
    expect(payload.variants[0]).not.toHaveProperty("rolls");
  });

  it("keeps each colour's own rolls to itself", () => {
    const payload = buildFabricPayload(common, [
      colour({ displayOrder: "Natural", rolls: [{ meters: "500" }] }),
      colour({ displayOrder: "Ivory", stockMeters: "750" }),
    ]);
    expect(payload.variants[0].rolls).toHaveLength(1);
    expect(payload.variants[1]).not.toHaveProperty("rolls");
    expect(payload.variants[1].stock_meters).toBe("750");
  });
});

describe("fabricToFormData with rolls", () => {
  it("writes one bracketed pair of keys per roll", () => {
    // This is the multipart shape the Django serializer's roll field parses.
    const form = fabricToFormData(
      buildFabricPayload(common, [
        colour({
          stockMeters: "1000",
          rolls: [{ meters: "500" }, { meters: "450" }],
        }),
      ]),
    );

    expect(form.get("variants[0]stock_meters")).toBe("1000");
    expect(form.get("variants[0]rolls[0][meters]")).toBe("500");
    expect(form.get("variants[0]rolls[1][meters]")).toBe("450");
    expect(form.get("variants[0]rolls[0][note]")).toBeNull();
  });

  it("writes one key per roll for a row entered as 100 m five times over", () => {
    // The dialog expands a "100 m x5" row into five entries before they get here,
    // so the wire shape is the same one row per roll has always been.
    const form = fabricToFormData(
      buildFabricPayload(common, [
        colour({
          stockMeters: "1000",
          rolls: Array(5).fill({ meters: "100" }),
        }),
      ]),
    );

    expect(form.get("variants[0]stock_meters")).toBe("1000");
    for (let i = 0; i < 5; i++) {
      expect(form.get(`variants[0]rolls[${i}][meters]`)).toBe("100");
    }
    expect(form.get("variants[0]rolls[5][meters]")).toBeNull();
  });

  it("indexes each colour's rolls separately", () => {
    const form = fabricToFormData(
      buildFabricPayload(common, [
        colour({ displayOrder: "Natural", rolls: [{ meters: "500" }] }),
        colour({
          displayOrder: "Ivory",
          stockMeters: "0",
          rolls: [{ meters: "300" }],
        }),
      ]),
    );

    expect(form.get("variants[0]rolls[0][meters]")).toBe("500");
    expect(form.get("variants[1]rolls[0][meters]")).toBe("300");
  });

  it("adds no roll keys for a roll-less colour", () => {
    const form = fabricToFormData(buildFabricPayload(common, [colour()]));

    expect(form.get("variants[0]stock_meters")).toBe("1000");
    expect([...form.keys()].some((k) => k.includes("rolls"))).toBe(false);
  });
});