import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VariantCard from "@/components/items/VariantCard";
import { rollApi } from "@/lib/api/item";
import { invalidateRolls } from "@/lib/rollsCache";
import type { FabricRoll, UIVariant, VariantRollsResponse } from "@/types/item";

vi.mock("@/components/pages/ImagePreview", () => ({
  ImagePreview: () => <span data-testid="image-preview" />,
}));

vi.mock("@/lib/api/item", () => ({
  rollApi: {
    getForVariant: vi.fn(),
    receive: vi.fn(),
    bulkReceive: vi.fn(),
    adjust: vi.fn(),
    history: vi.fn(),
  },
}));

vi.mock("@/lib/toast", () => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastErrorFromError: vi.fn(),
  toastInfo: vi.fn(),
}));

/**
 * Each label carries its own QR. The encoder is stubbed so a test is about which
 * roll a code belongs to rather than about how a QR is drawn.
 *
 * Held in its own typed reference because `qrcode` types `toDataURL` through
 * overloads (one of which streams to a writable and resolves to void), which
 * leaves `mockResolvedValue` on the wrong overload.
 */
const toDataURL = vi.hoisted(() => vi.fn<(text: string) => Promise<string>>());

vi.mock("qrcode", () => ({ default: { toDataURL } }));

const getForVariant = vi.mocked(rollApi.getForVariant);

const VARIANT_ID = 7;

function variant(over: Partial<UIVariant> = {}): UIVariant {
  return {
    id: VARIANT_ID,
    image: null,
    qr_code: "FABRICQRCOD",
    display_order: "green",
    stock_meters: "100.000",
    ...over,
  };
}

function roll(over: Partial<FabricRoll> = {}): FabricRoll {
  return {
    id: 1,
    variant: VARIANT_ID,
    roll_number: "NAT-0001",
    note: "",
    original_meters: "100.000",
    remaining_meters: "100.000",
    consumed_meters: "0.000",
    is_active: true,
    is_exhausted: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function rollsResponse(over: Partial<VariantRollsResponse> = {}): VariantRollsResponse {
  const rolls = over.rolls ?? [
    roll(),
    roll({ id: 2, roll_number: "NAT-0002", remaining_meters: "40.000" }),
  ];
  return {
    variant: VARIANT_ID,
    fabric: "Cotton Checks",
    display_order: "green",
    price_per_meter: "9.00",
    stock_meters: "140.000",
    is_roll_tracked: true,
    roll_count: rolls.length,
    active_roll_count: rolls.filter((r) => r.is_active).length,
    exhausted_roll_count: rolls.filter((r) => r.is_exhausted).length,
    total_received_meters: "200.000",
    roll_stock_meters: "140.000",
    consumed_meters: "60.000",
    largest_roll_meters: "100.000",
    smallest_roll_meters: "40.000",
    rolls,
    ...over,
  } as VariantRollsResponse;
}

/** The card as the Inventory page renders it. */
function renderCard(over: Partial<UIVariant> = {}, onPrintQR = vi.fn()) {
  return {
    onPrintQR,
    ...render(
      <VariantCard
        variant={variant(over)}
        index={1}
        context="admin"
        onPrintQR={onPrintQR}
      />,
    ),
  };
}

/** Open the card: click the colour heading, which is the toggle. */
async function expand() {
  await userEvent.click(screen.getByRole("button", { expanded: false }));
}

beforeEach(() => {
  vi.clearAllMocks();
  // The rolls cache is shared and outlives a test on purpose, so it is emptied
  // here rather than letting one test's read answer another's.
  invalidateRolls();
  getForVariant.mockResolvedValue(rollsResponse());
  toDataURL.mockImplementation((text) =>
    Promise.resolve(`data:image/png;base64,${text}`),
  );
});

describe("VariantCard physical rolls", () => {
  it("starts collapsed and reads nothing until it is opened", async () => {
    renderCard();

    expect(screen.getByText("Color #green")).toBeTruthy();
    expect(screen.queryByText(/Physical Rolls/i)).toBeNull();
    // The stock list carries no roll counts, so the rolls are read on opening.
    expect(getForVariant).not.toHaveBeenCalled();
  });

  it("expands to show the colour's rolls, then collapses again", async () => {
    getForVariant.mockResolvedValue(rollsResponse());
    renderCard();

    await expand();
    // The same figures the Edit Inventory panel shows for this colour.
    expect(await screen.findByText("NAT-0001")).toBeTruthy();
    expect(screen.getByText("100 m left of 100")).toBeTruthy();
    expect(screen.getByText("NAT-0002")).toBeTruthy();
    expect(screen.getByText("40 m left of 100")).toBeTruthy();
    expect(screen.getByText("140 m · 2 rolls")).toBeTruthy();
    expect(getForVariant).toHaveBeenCalledWith(VARIANT_ID);

    await userEvent.click(screen.getByRole("button", { expanded: true }));

    expect(screen.queryByText("NAT-0001")).toBeNull();
    expect(screen.queryByText(/Physical Rolls/i)).toBeNull();
  });

  it("shows the roll note and the used-up marker as the panel does", async () => {
    getForVariant.mockResolvedValue(
      rollsResponse({
        rolls: [
          roll({ note: "second batch" }),
          roll({
            id: 2,
            roll_number: "NAT-0002",
            remaining_meters: "0.000",
            is_active: false,
            is_exhausted: true,
          }),
        ],
      }),
    );
    renderCard();

    await expand();

    expect(await screen.findByText("second batch")).toBeTruthy();
    expect(screen.getByText(/0 m left of 100 · used up/)).toBeTruthy();
    expect(screen.getByText("1 used up")).toBeTruthy();
  });

  it("offers no print button for a colour with no rolls, and says so", async () => {
    getForVariant.mockResolvedValue(
      rollsResponse({
        rolls: [],
        roll_count: 0,
        active_roll_count: 0,
        exhausted_roll_count: 0,
        roll_stock_meters: "0.000",
        stock_meters: "1000.000",
        is_roll_tracked: false,
      }),
    );
    renderCard();

    await expand();

    expect(await screen.findByText(/has no physical rolls/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /print all/i })).toBeNull();
  });

  it("prints one label per active roll, and leaves out the used-up ones", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    getForVariant.mockResolvedValue(
      rollsResponse({
        rolls: [
          roll({ id: 1, roll_number: "NAT-0001" }),
          roll({
            id: 2,
            roll_number: "NAT-0002",
            remaining_meters: "0.000",
            is_active: false,
            is_exhausted: true,
          }),
          roll({ id: 3, roll_number: "NAT-0003" }),
        ],
        exhausted_roll_count: 1,
      }),
    );
    renderCard();

    await expand();
    await userEvent.click(await screen.findByRole("button", { name: /print all/i }));

    const dialog = await screen.findByRole("heading", { name: /2 roll labels/i });
    const sheet = dialog.closest("div")!.parentElement!;
    // A label is scanned to pick one exact roll, so a roll that has been cut to
    // zero is not labelled: two labels here, not three.
    expect(within(sheet).getAllByText("NAT-0001").length).toBeGreaterThan(0);
    expect(within(sheet).getByText("NAT-0003")).toBeTruthy();
    expect(within(sheet).queryByText("NAT-0002")).toBeNull();
    expect(
      within(sheet).getAllByAltText(/QR code for roll NAT-0001/).length,
    ).toBe(1);
    expect(
      within(sheet).getAllByAltText(/QR code for roll NAT-0003/).length,
    ).toBe(1);
    // Each code carries its own roll's id, not one shared code.
    expect(toDataURL).toHaveBeenCalledWith("1", expect.anything());
    expect(toDataURL).toHaveBeenCalledWith("3", expect.anything());
    expect(toDataURL).not.toHaveBeenCalledWith("2", expect.anything());

    // One print job for the whole sheet.
    await userEvent.click(screen.getByRole("button", { name: /print 2 labels/i }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it("values each label from the roll's received length", async () => {
    vi.spyOn(window, "print").mockImplementation(() => {});
    // Valued on what arrived, not on what is left: the 40 m left of the second
    // roll was cut for an order and is not this roll to be worth.
    getForVariant.mockResolvedValue(
      rollsResponse({
        rolls: [
          roll({ id: 1, original_meters: "100.000", remaining_meters: "100.000" }),
          roll({
            id: 2,
            roll_number: "NAT-0002",
            original_meters: "40.000",
            remaining_meters: "40.000",
          }),
        ],
      }),
    );
    renderCard();

    await expand();
    await userEvent.click(await screen.findByRole("button", { name: /print all/i }));

    // Rs. 9.00/m: 100 m is Rs. 900, 40 m is Rs. 360.
    expect(await screen.findAllByText("Rs. 900.00")).toHaveLength(1);
    expect(screen.getAllByText("Rs. 360.00")).toHaveLength(1);
    expect(screen.getAllByText("Rs. 9.00/m × 100 m")).toHaveLength(1);
    expect(screen.getAllByText("Rs. 9.00/m × 40 m")).toHaveLength(1);
  });

  it("waits for every code before it will print", async () => {
    vi.spyOn(window, "print").mockImplementation(() => {});
    // Every code is pending: one resolver per call, all held until released.
    const release: (() => void)[] = [];
    toDataURL.mockImplementation(
      () =>
        new Promise((resolve) => {
          release.push(() => resolve("data:image/png;base64,QR"));
        }),
    );
    renderCard();

    await expand();
    await userEvent.click(await screen.findByRole("button", { name: /print all/i }));
    const button = await screen.findByRole("button", { name: /print 2 labels/i });
    // Half a sheet of labels on cloth is worse than a moment's wait.
    expect(button).toHaveProperty("disabled", true);
    expect(release).toHaveLength(2);

    release.forEach((resolve) => resolve());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /print 2 labels/i })).toHaveProperty(
        "disabled",
        false,
      ),
    );
  });

  it("prints one roll's label on its own, from that roll's own button", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    renderCard();

    await expand();
    await userEvent.click(
      await screen.findByRole("button", { name: /print label for NAT-0002/i }),
    );

    // The single-roll dialog, not the sheet: one heading naming one roll.
    const heading = await screen.findByRole("heading", {
      name: "NAT-0002 label",
    });
    const dialog = heading.closest("div")!.parentElement!;
    // Only that roll is encoded: printing one roll must not draw every code.
    expect(toDataURL).toHaveBeenCalledWith("2", expect.anything());
    expect(toDataURL).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByAltText("QR code for roll NAT-0002")).toBeTruthy();
    // The list stays mounted behind the dialog, as it does in the panel, so the
    // check that no other label is in this dialog has to look inside it.
    expect(within(dialog).queryByText("NAT-0001")).toBeNull();
    expect(within(dialog).queryByAltText(/QR code for roll NAT-0001/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /^Print label$/i }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it("offers a label for a used-up roll, which print-all leaves out", async () => {
    vi.spyOn(window, "print").mockImplementation(() => {});
    getForVariant.mockResolvedValue(
      rollsResponse({
        rolls: [
          roll({ id: 1, roll_number: "NAT-0001" }),
          roll({
            id: 2,
            roll_number: "NAT-0002",
            remaining_meters: "0.000",
            is_active: false,
            is_exhausted: true,
          }),
        ],
        exhausted_roll_count: 1,
      }),
    );
    renderCard();

    await expand();

    // Asking for one specific roll is deliberate -- a re-tagged roll, or the
    // warehouse's record of one that is done -- so it is offered even though the
    // sheet would skip it.
    const button = await screen.findByRole("button", {
      name: /print label for NAT-0002/i,
    });
    expect(button).toBeTruthy();
    await userEvent.click(button);

    expect(
      await screen.findByRole("heading", { name: "NAT-0002 label" }),
    ).toBeTruthy();
    expect(toDataURL).toHaveBeenCalledWith("2", expect.anything());
  });

  it("closes one roll's label without disturbing the list", async () => {
    renderCard();

    await expand();
    await userEvent.click(
      await screen.findByRole("button", { name: /print label for NAT-0001/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /close roll label/i }));

    expect(screen.queryByRole("heading", { name: /label$/i })).toBeNull();
    // The list is still open and still shows both rolls.
    expect(screen.getByText("NAT-0001")).toBeTruthy();
    expect(screen.getByText("NAT-0002")).toBeTruthy();
    expect(screen.getByRole("button", { name: /print all/i })).toBeTruthy();
  });

  it("keeps the card's own QR button working, and does not expand on it", async () => {
    const onPrintQR = vi.fn();
    renderCard({}, onPrintQR);

    await userEvent.click(
      screen.getByRole("button", { name: /print QR code for Color #green/i }),
    );

    expect(onPrintQR).toHaveBeenCalledWith("FABRICQRCOD", VARIANT_ID);
    // The QR sheet is its own screen; the card must not have opened behind it.
    expect(screen.queryByText(/Physical Rolls/i)).toBeNull();
    expect(getForVariant).not.toHaveBeenCalled();
  });

  it("does not offer rolls to an agent", async () => {
    render(
      <VariantCard variant={variant()} index={1} context="agent" />,
    );

    expect(screen.queryByRole("button", { expanded: false })).toBeNull();
  });

  it("re-opens from memory, without asking again", async () => {
    renderCard();

    await expand();
    expect(await screen.findByText("NAT-0001")).toBeTruthy();

    // Collapsing and coming back is the common case on this page, and it used to
    // cost a round trip and a spinner every time.
    await userEvent.click(screen.getByRole("button", { expanded: true }));
    await expand();

    expect(screen.getByText("NAT-0001")).toBeTruthy();
    expect(screen.getByText("140 m · 2 rolls")).toBeTruthy();
    expect(getForVariant).toHaveBeenCalledTimes(1);
  });

  it("opens with no spinner once the rolls are already in memory", async () => {
    const { unmount } = renderCard();
    await expand();
    expect(await screen.findByText("NAT-0001")).toBeTruthy();
    unmount();

    // A fresh card for the same colour: the read is already done, so there is
    // nothing to wait for.
    renderCard();
    await expand();

    expect(screen.getByText("NAT-0001")).toBeTruthy();
    expect(screen.queryByText(/Loading rolls/i)).toBeNull();
    expect(getForVariant).toHaveBeenCalledTimes(1);
  });

  it("warms the rolls on hover, so the click is already answered", async () => {
    renderCard();

    await userEvent.hover(screen.getByRole("button", { expanded: false }));
    await waitFor(() => expect(getForVariant).toHaveBeenCalledWith(VARIANT_ID));

    await expand();

    expect(screen.getByText("NAT-0001")).toBeTruthy();
    // The hover and the click are one read between them, not two.
    expect(getForVariant).toHaveBeenCalledTimes(1);
  });
});