import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import EditVariantRow from "@/app/(admin)/admin/items/edit/[id]/editVariantRow";
import type { EditableVariant } from "@/types/item";

vi.mock("@/components/pages/ImagePreview", () => ({
  ImagePreview: () => <span data-testid="image-preview" />,
}));

const existing = (over: Partial<EditableVariant> = {}): EditableVariant => ({
  backendId: 7,
  localId: "a",
  stockMeters: "100.000",
  displayOrder: "Natural",
  imageUrl: null,
  newImage: null,
  imagePreview: null,
  isRollTracked: true,
  rollCount: 1,
  ...over,
});

/** No callbacks do anything here: this is about what the row displays. */
const noop = () => {};

function renderRow(variant: EditableVariant, isNew = false) {
  return render(
    <EditVariantRow
      variant={variant}
      index={0}
      isOnly
      isNew={isNew}
      onChange={noop}
      onDelete={noop}
      onPickImage={noop}
    />,
  );
}

describe("EditVariantRow roll badge", () => {
  // The badge quotes the roll count sitting directly above the Physical Rolls
  // panel, which keeps its own copy from the API. It used to keep the count the
  // page loaded with, so after a receive it read "0 rolls" over a panel showing
  // one. Both numbers now arrive together from that panel.
  it("shows the roll count it is given", () => {
    renderRow(existing({ rollCount: 1 }));

    expect(screen.getByText(/derived from physical rolls · 1 roll$/i)).toBeTruthy();
  });

  it("pluralises a count above one", () => {
    renderRow(existing({ rollCount: 3 }));

    expect(screen.getByText(/derived from physical rolls · 3 rolls/i)).toBeTruthy();
  });

  it("shows the metre total the panel reported, read-only", () => {
    renderRow(existing({ stockMeters: "100.000" }));

    const field = screen.getByDisplayValue("100.000");
    expect(field).toHaveProperty("readOnly", true);
    expect(screen.getByText(/Stock \(derived from physical rolls\)/i)).toBeTruthy();
  });

  it("hides the badge for a colour with no rolls yet", () => {
    // Not roll-tracked means not derived from anything, so claiming otherwise
    // would be wrong.
    renderRow(existing({ isRollTracked: false, rollCount: 0, stockMeters: "1000" }));

    expect(screen.queryByText(/derived from physical rolls/i)).toBeNull();
    expect(screen.getByText(/^Stock$/i)).toBeTruthy();
    expect(screen.getByDisplayValue("1000")).toHaveProperty("readOnly", false);
  });

  it("hides the badge for a colour being created, which has no rolls", () => {
    renderRow(existing({ isRollTracked: true, rollCount: 1 }), true);

    expect(screen.queryByText(/derived from physical rolls/i)).toBeNull();
    expect(screen.getByText(/^Opening$/i)).toBeTruthy();
  });

  it("treats a missing count as zero rather than rendering nothing", () => {
    renderRow(existing({ rollCount: undefined }));

    expect(screen.getByText(/derived from physical rolls · 0 rolls/i)).toBeTruthy();
  });
});