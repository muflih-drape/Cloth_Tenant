import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import OrderItemEditModal from "@/components/pages/admin/order-item/orderItemEdit";
import { fabricApi } from "@/lib/api/item";
import type { OrderItem } from "@/types/order";

vi.mock("@/lib/api/item", () => ({
  fabricApi: { getAllVariants: vi.fn() },
}));

vi.mock("@/components/ui/custom/Modals", () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ModalButton: ({ children, ...rest }: { children: React.ReactNode }) => (
    <button {...rest}>{children}</button>
  ),
}));

const getAllVariants = vi.mocked(fabricApi.getAllVariants);

/** A 100 m colour with a line the agent is retyping. */
function setup(availableMeters: string | null | undefined, ordered = "100.000") {
  const item = {
    id: 1,
    fabric: 3,
    variant: 7,
    variant_display_order: "Natural",
    fabric_name: "Cotton Cambric",
    fabric_name_display: "Cotton Cambric",
    rate_per_meter: "9.00",
    original_rate_per_meter: null,
    is_rate_overridden: false,
    rate_overridden_by: null,
    rate_overridden_at: null,
    variant_image: null,
    ordered_quantity: ordered,
    allocated_quantity: "0.000",
    outstanding_quantity: ordered,
    line_total: "900.00",
    allocation_count: 0,
    is_roll_tracked: true,
    variant_available_meters: availableMeters,
  } satisfies OrderItem;

  const onSave = vi.fn();

  // The modal is controlled, so the harness holds the typed metres the way the
  // real parent does. Without this the input would never report a new figure and
  // there would be nothing to warn about.
  function Harness() {
    const [metres, setMetres] = useState(ordered);
    return (
      <OrderItemEditModal
        item={item}
        metres={metres}
        variantId={7}
        availableMeters={availableMeters}
        metresError={null}
        setMetres={setMetres}
        setVariantId={vi.fn()}
        setMetresError={vi.fn()}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );
  }

  return { ...render(<Harness />), onSave };
}

/**
 * Retyping a line's metres, warned about *before* it is saved.
 *
 * Demand outrunning supply is allowed here, so this never stops the save. What
 * `variant_available_meters` gives us already has this line's own claim taken
 * out, so the typed figure is compared against it directly.
 */
describe("order form availability warning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAllVariants.mockResolvedValue([]);
  });

  it("shows how much is available while the figure is still positive", async () => {
    setup("40.000");

    await waitFor(() => expect(getAllVariants).toHaveBeenCalled());

    expect(screen.getByText(/40 m of this colour available for ordering/)).toBeTruthy();
    expect(screen.queryByText(/You can still proceed/)).toBeNull();
  });

  it("warns that the typed quantity takes it negative, without blocking", async () => {
    const user = userEvent.setup();
    const { onSave } = setup("40.000");

    await waitFor(() => expect(getAllVariants).toHaveBeenCalled());

    const field = screen.getByLabelText(/Metres required/);

    // Typing over the 100 m already ordered: 100 -> 200 costs another 100 m of a
    // colour with 40 m left, so it lands 60 m into the red.
    await user.clear(field);
    await user.type(field, "200");

    expect(screen.getByText(/Only 40 m available/)).toBeTruthy();
    expect(screen.getByText(/You can still proceed/)).toBeTruthy();
    // Advisory only: the field is still enabled and nothing was committed.
    expect(
      (screen.getByLabelText(/Metres required/) as HTMLInputElement).disabled,
    ).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("clears the warning when the line is cut back within what is left", async () => {
    const user = userEvent.setup();
    setup("40.000");

    await waitFor(() => expect(getAllVariants).toHaveBeenCalled());

    const field = screen.getByLabelText(/Metres required/);
    await user.clear(field);
    await user.type(field, "200");
    expect(screen.getByText(/You can still proceed/)).toBeTruthy();

    await user.clear(field);
    await user.type(field, "50");

    expect(screen.queryByText(/You can still proceed/)).toBeNull();
    expect(screen.getByText(/available for ordering/)).toBeTruthy();
  });

  it("says so straight away when the colour was already oversold", async () => {
    setup("-60.000");

    await waitFor(() => expect(getAllVariants).toHaveBeenCalled());

    expect(screen.getByText(/Already oversold by 60 m on other orders/)).toBeTruthy();
    expect(screen.getByText(/You can still proceed/)).toBeTruthy();
  });

  it("stays quiet when the server sends no availability to judge", async () => {
    setup(undefined);

    await waitFor(() => expect(getAllVariants).toHaveBeenCalled());

    expect(screen.queryByText(/You can still proceed/)).toBeNull();
    expect(screen.queryByText(/available for ordering/)).toBeNull();
  });
});