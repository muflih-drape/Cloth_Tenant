import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PhysicalRollsPanel from "@/components/items/physicalRollsPanel";
import { rollApi } from "@/lib/api/item";
import type { VariantRollsResponse } from "@/types/item";

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

const QR_DATA_URL = "data:image/png;base64,AAAA";

/**
 * The label's QR is a real image the browser would draw; stubbing the encoder
 * keeps the test on what the payload is rather than on the encoding.
 *
 * Held in its own typed reference because `qrcode` types `toDataURL` through
 * overloads (one of which streams to a writable and resolves to void), which
 * leaves `mockResolvedValue` on the wrong overload.
 */
const toDataURL = vi.hoisted(() => vi.fn<(text: string) => Promise<string>>());

vi.mock("qrcode", () => ({ default: { toDataURL } }));

const getForVariant = vi.mocked(rollApi.getForVariant);
const receive = vi.mocked(rollApi.receive);
const bulkReceive = vi.mocked(rollApi.bulkReceive);
const adjust = vi.mocked(rollApi.adjust);
const history = vi.mocked(rollApi.history);

function rollsResponse(overrides: Partial<VariantRollsResponse> = {}) {
  return {
    variant: 7,
    fabric: "Cotton Cambric",
    display_order: "Natural",
    price_per_meter: "9.00",
    stock_meters: "90.000",
    is_roll_tracked: true,
    roll_count: 2,
    active_roll_count: 2,
    exhausted_roll_count: 0,
    total_received_meters: "150.000",
    roll_stock_meters: "90.000",
    consumed_meters: "60.000",
    largest_roll_meters: "100.000",
    smallest_roll_meters: "50.000",
    rolls: [
      {
        id: 1,
        variant: 7,
        roll_number: "NAT-0001",
        note: "",
        original_meters: "100.000",
        remaining_meters: "40.000",
        consumed_meters: "60.000",
        is_active: true,
        is_exhausted: false,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      },
      {
        id: 2,
        variant: 7,
        roll_number: "NAT-0002",
        note: "second batch",
        original_meters: "50.000",
        remaining_meters: "50.000",
        consumed_meters: "0.000",
        is_active: true,
        is_exhausted: false,
        created_at: "2026-01-03T00:00:00Z",
        updated_at: "2026-01-03T00:00:00Z",
      },
    ],
    ...overrides,
  } as VariantRollsResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  getForVariant.mockResolvedValue(rollsResponse());
  // Set here rather than in the mock factory because clearing wipes it.
  toDataURL.mockResolvedValue(QR_DATA_URL);
});

/** The panel starts collapsed, so anything below the summary needs opening. */
async function expand() {
  await userEvent.click(
    screen.getByRole("button", { name: /physical rolls/i }),
  );
}

describe("PhysicalRollsPanel", () => {
  it("summarises the rolls and reports the colour's stock to its page", async () => {
    const onStockChanged = vi.fn();
    render(
      <PhysicalRollsPanel
        variantId={7}
        label="Cotton Cambric"
        onStockChanged={onStockChanged}
      />,
    );

// The header reads "Total: 90 m · 2 rolls"; assert the figures rather than
    // the separator between them.
    await waitFor(() => expect(screen.getByText(/Total: 90 m/i)).toBeTruthy());
    expect(screen.getByText(/2 rolls/i)).toBeTruthy();
    // The count travels with the metres: the badge above the panel quotes the
    // same number, so sending only the metres left it stale at whatever the page
    // loaded with.
    expect(onStockChanged).toHaveBeenCalledWith("90.000", 2);
  });

  it("lists each roll with what is left when opened", async () => {
    render(<PhysicalRollsPanel variantId={7} label="Cotton Cambric" />);

    await waitFor(() => screen.getByText(/2 rolls/i));
    await expand();

    expect(screen.getByText("NAT-0001")).toBeTruthy();
    expect(screen.getByText("NAT-0002")).toBeTruthy();
    expect(screen.getByText(/40 m left of 100/)).toBeTruthy();
    expect(screen.getByText(/second batch/)).toBeTruthy();
  });

  it("sends a single figure as one roll", async () => {
    receive.mockResolvedValue({
      ...rollsResponse(),
      roll: rollsResponse().rolls[0],
    } as never);
    render(<PhysicalRollsPanel variantId={7} label="Cotton Cambric" />);

    await waitFor(() => screen.getByText(/2 rolls/i));
    await expand();
    await userEvent.click(screen.getByRole("button", { name: /receive rolls/i }));
    await userEvent.type(screen.getByLabelText("Roll 1 metres"), "35.5");
    await userEvent.click(screen.getByRole("button", { name: /^Receive$/i }));

    await waitFor(() =>
      expect(receive).toHaveBeenCalledWith(7, { meters: "35.5" }),
    );
    expect(bulkReceive).not.toHaveBeenCalled();
  });

  it("sends several figures as one atomic bulk receive", async () => {
    bulkReceive.mockResolvedValue({
      ...rollsResponse(),
      created: 2,
      total_meters: "80.000",
    });
    render(<PhysicalRollsPanel variantId={7} label="Cotton Cambric" />);

    await waitFor(() => screen.getByText(/2 rolls/i));
    await expand();
    await userEvent.click(screen.getByRole("button", { name: /receive rolls/i }));
    await userEvent.type(screen.getByLabelText("Roll 1 metres"), "30");
    await userEvent.click(screen.getByRole("button", { name: /add another length/i }));
    await userEvent.type(screen.getByLabelText("Roll 2 metres"), "50");
    await userEvent.click(screen.getByRole("button", { name: /^Receive$/i }));

    await waitFor(() =>
      expect(bulkReceive).toHaveBeenCalledWith(7, [
        { meters: "30" },
        { meters: "50" },
      ]),
    );
    expect(receive).not.toHaveBeenCalled();
  });

  it("refuses a zero or blank figure without asking the server", async () => {
    render(<PhysicalRollsPanel variantId={7} label="Cotton Cambric" />);

    await waitFor(() => screen.getByText(/2 rolls/i));
    await expand();
    await userEvent.click(screen.getByRole("button", { name: /receive rolls/i }));
    await userEvent.click(screen.getByRole("button", { name: /^Receive$/i }));

    expect(
      await screen.findByText(/Roll 1: enter how many metres it holds/i),
    ).toBeTruthy();
    expect(receive).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Roll 1 metres"), "-4");
    await userEvent.click(screen.getByRole("button", { name: /^Receive$/i }));
    expect(
      await screen.findByText(/Roll 1: metres must be greater than zero/i),
    ).toBeTruthy();
    expect(receive).not.toHaveBeenCalled();
  });

  it("adjusts a roll by a signed difference and refreshes", async () => {
    adjust.mockResolvedValue(rollsResponse().rolls[0] as never);
    render(<PhysicalRollsPanel variantId={7} label="Cotton Cambric" />);

    await waitFor(() => screen.getByText(/2 rolls/i));
    await expand();
    await userEvent.click(screen.getByRole("button", { name: /adjust NAT-0001/i }));
    await userEvent.type(
      screen.getByLabelText("Adjustment for NAT-0001"),
      "-2.5",
    );
    await userEvent.click(screen.getByRole("button", { name: /^Apply$/i }));

    await waitFor(() => expect(adjust).toHaveBeenCalledWith(1, "-2.5"));
    expect(getForVariant).toHaveBeenCalledTimes(2);
  });

  it("keeps the dialog open and shows the message when the server refuses", async () => {
    receive.mockRejectedValue({ response: { data: { error: "Not enough cloth." } } });
    render(<PhysicalRollsPanel variantId={7} label="Cotton Cambric" />);

    await waitFor(() => screen.getByText(/2 rolls/i));
    await expand();
    await userEvent.click(screen.getByRole("button", { name: /receive rolls/i }));
    await userEvent.type(screen.getByLabelText("Roll 1 metres"), "5");
    await userEvent.click(screen.getByRole("button", { name: /^Receive$/i }));

    expect(await screen.findByText("Not enough cloth.")).toBeTruthy();
    expect(screen.getByLabelText("Roll 1 metres")).toBeTruthy();
  });

  it("shows where metres were cut from in a roll's history", async () => {
    history.mockResolvedValue({
      roll: rollsResponse().rolls[0] as never,
      entries: [
        {
          id: 11,
          roll_number: "NAT-0001",
          metres: "60.000",
          is_reversed: false,
          created_at: "2026-02-01T00:00:00Z",
          round: 3,
          round_status: "CONFIRMED",
          order: 42,
          order_status: "PACKED",
          customer: "Riya Textiles",
          order_item: 5,
        },
      ],
    } as never);
    render(<PhysicalRollsPanel variantId={7} label="Cotton Cambric" />);

    await waitFor(() => screen.getByText(/2 rolls/i));
    await expand();
    await userEvent.click(screen.getByRole("button", { name: /history for NAT-0001/i }));

    expect(await screen.findByText(/Riya Textiles · order #42/)).toBeTruthy();
    expect(screen.getByText(/round #3/)).toBeTruthy();
  });

  it("offers receiving but no rolls when the colour has none yet", async () => {
    getForVariant.mockResolvedValue(
      rollsResponse({
        rolls: [],
        roll_count: 0,
        active_roll_count: 0,
        exhausted_roll_count: 0,
        roll_stock_meters: "0.000",
        stock_meters: "0.000",
        is_roll_tracked: false,
      }),
    );
    render(<PhysicalRollsPanel variantId={7} label="Cotton Cambric" />);

    expect(await screen.findByText(/no rolls received yet/i)).toBeTruthy();
    await expand();
    expect(screen.getByRole("button", { name: /receive rolls/i })).toBeTruthy();
  });

  it("prints a label carrying the roll's own id, its length and its value", async () => {
    render(<PhysicalRollsPanel variantId={7} label="Cotton Cambric" />);

    await waitFor(() => screen.getByText(/2 rolls/i));
    await expand();
    await userEvent.click(
      screen.getByRole("button", { name: /print label for NAT-0001/i }),
    );

    // The label names the roll, the colour and what it is worth: 100 m received at
    // Rs. 9.00/m, so the label says 900 even though 60 m has since been cut off.
    expect(await screen.findByText("NAT-0001 label")).toBeTruthy();
    expect(screen.getByText("Cotton Cambric")).toBeTruthy();
    expect(screen.getByText("Color #Natural")).toBeTruthy();
    expect(screen.getByText("Rs. 900.00")).toBeTruthy();
    expect(screen.getByText("Rs. 9.00/m × 100 m")).toBeTruthy();
  });

  it("puts the scanned roll's id in the label's QR code", async () => {
    render(<PhysicalRollsPanel variantId={7} label="Cotton Cambric" />);

    await waitFor(() => screen.getByText(/2 rolls/i));
    await expand();
    await userEvent.click(
      screen.getByRole("button", { name: /print label for NAT-0002/i }),
    );

    // The payload is the roll's primary key, so a scan of this label resolves to
    // this roll and not to a colour that may have several lengths on the shelf.
    await waitFor(() => expect(toDataURL).toHaveBeenCalled());
    expect(toDataURL.mock.calls[0][0]).toBe("2");
    expect(
      await screen.findByAltText("QR code for roll NAT-0002"),
    ).toHaveProperty("src", "data:image/png;base64,AAAA");
  });

  it("sends the browser print dialog for the label", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<PhysicalRollsPanel variantId={7} label="Cotton Cambric" />);

    await waitFor(() => screen.getByText(/2 rolls/i));
    await expand();
    await userEvent.click(
      screen.getByRole("button", { name: /print label for NAT-0001/i }),
    );

    const button = await screen.findByRole("button", { name: /^Print label$/i });
    await userEvent.click(button);

    expect(print).toHaveBeenCalled();
    print.mockRestore();
  });
});

/**
 * The first roll onto a colour created with a plain metre figure replaces that
 * figure rather than adding to it, so the swap is confirmed before it happens.
 */
describe("PhysicalRollsPanel first roll on untracked stock", () => {
  /** A colour with no rolls but a plain opening figure on hand. */
  function untracked(overrides: Partial<VariantRollsResponse> = {}) {
    return rollsResponse({
      rolls: [],
      roll_count: 0,
      active_roll_count: 0,
      exhausted_roll_count: 0,
      total_received_meters: "0.000",
      roll_stock_meters: "0.000",
      consumed_meters: "0.000",
      largest_roll_meters: "0.000",
      smallest_roll_meters: "0.000",
      stock_meters: "1000.000",
      is_roll_tracked: false,
      ...overrides,
    });
  }

  /** Open the panel, expand it and open the receive dialog. */
  async function startReceive() {
    await waitFor(() => screen.getByText(/no rolls received yet/i));
    await expand();
    await userEvent.click(screen.getByRole("button", { name: /receive rolls/i }));
  }

  /** Fill the first row and press Receive in the dialog. */
  async function submitDraft(metres: string) {
    await userEvent.type(screen.getByLabelText("Roll 1 metres"), metres);
    await userEvent.click(screen.getByRole("button", { name: /^Receive$/i }));
  }

  it("adds to the opening figure instead of replacing it", async () => {
    // The figure is cloth already on hand, so a roll is a further delivery on top
    // of it. The API records the figure as a roll of its own, so it still counts
    // and can still be cut -- there is nothing to confirm and nothing to lose.
    receive.mockResolvedValue({
      ...rollsResponse(),
      roll: rollsResponse().rolls[0],
    } as never);
    // The panel reloads after receiving, and now has its first roll.
    getForVariant
      .mockResolvedValueOnce(untracked())
      .mockResolvedValueOnce(rollsResponse({ roll_count: 1, stock_meters: "1100.000" }));
    render(<PhysicalRollsPanel variantId={7} label="Cotton Cambric" />);

    await startReceive();
    await submitDraft("100");

    await waitFor(() => expect(receive).toHaveBeenCalledWith(7, { meters: "100" }));
    expect(screen.queryByText(/Replace untracked stock\?/i)).toBeNull();
    expect(screen.queryByText(/will no longer be counted/i)).toBeNull();
  });

  it("receives a multi-roll delivery onto an untracked colour in one request", async () => {
    bulkReceive.mockResolvedValue({
      ...rollsResponse(),
      created: 5,
      total_meters: "500.000",
      stock_meters: "1500.000",
      rolls: [],
    } as never);
    getForVariant
      .mockResolvedValueOnce(untracked())
      .mockResolvedValueOnce(
        rollsResponse({ roll_count: 5, stock_meters: "1500.000" }),
      );
    render(<PhysicalRollsPanel variantId={7} label="Cotton Cambric" />);

    await startReceive();
    // "100 m, five of them" is one row, and the count is expanded before sending.
    await userEvent.type(screen.getByLabelText("Roll 1 metres"), "100");
    await userEvent.clear(screen.getByLabelText("Roll 1 count"));
    await userEvent.type(screen.getByLabelText("Roll 1 count"), "5");
    await userEvent.click(screen.getByRole("button", { name: /^Receive$/i }));

    await waitFor(() =>
      expect(bulkReceive).toHaveBeenCalledWith(7, [
        { meters: "100" },
        { meters: "100" },
        { meters: "100" },
        { meters: "100" },
        { meters: "100" },
      ]),
    );
    expect(receive).not.toHaveBeenCalled();
  });

  it("adds to a colour that already has a roll", async () => {
    receive.mockResolvedValue({
      ...rollsResponse(),
      roll: rollsResponse().rolls[0],
    } as never);
    render(<PhysicalRollsPanel variantId={7} label="Cotton Cambric" />);

    await waitFor(() => screen.getByText(/2 rolls/i));
    await expand();
    await userEvent.click(screen.getByRole("button", { name: /receive rolls/i }));
    await submitDraft("35");

    await waitFor(() =>
      expect(receive).toHaveBeenCalledWith(7, { meters: "35" }),
    );
  });

  it("receives onto a colour whose opening figure is zero", async () => {
    getForVariant.mockResolvedValue(untracked({ stock_meters: "0.000" }));
    receive.mockResolvedValue({
      ...rollsResponse(),
      roll: rollsResponse().rolls[0],
    } as never);
    render(<PhysicalRollsPanel variantId={7} label="Cotton Cambric" />);

    await startReceive();
    await submitDraft("100");

    await waitFor(() =>
      expect(receive).toHaveBeenCalledWith(7, { meters: "100" }),
    );
  });

  it("reports the new roll's count up so the badge above cannot go stale", async () => {
    const onStockChanged = vi.fn();
    getForVariant
      .mockResolvedValueOnce(untracked())
      // The figure's own roll plus the one received, and both sets of metres.
      .mockResolvedValueOnce(
        rollsResponse({ roll_count: 2, stock_meters: "1100.000" }),
      );
    receive.mockResolvedValue({
      ...rollsResponse(),
      roll: rollsResponse().rolls[0],
    } as never);
    render(
      <PhysicalRollsPanel
        variantId={7}
        label="Cotton Cambric"
        onStockChanged={onStockChanged}
      />,
    );

    await startReceive();
    await submitDraft("100");

    // The pair that keeps the badge and the panel agreeing: 1100 m over 2 rolls.
    await waitFor(() =>
      expect(onStockChanged).toHaveBeenLastCalledWith("1100.000", 2),
    );
  });

  it("reports a consumed roll's remaining total without changing the count", async () => {
    // Packing empties a roll but keeps the row, so the count holds while the
    // total falls. The badge quotes the count, so both numbers must be reported.
    const onStockChanged = vi.fn();
    getForVariant.mockResolvedValue(
      rollsResponse({
        roll_count: 2,
        active_roll_count: 1,
        roll_stock_meters: "40.000",
        stock_meters: "40.000",
      }),
    );
    render(
      <PhysicalRollsPanel
        variantId={7}
        label="Cotton Cambric"
        onStockChanged={onStockChanged}
      />,
    );

    await waitFor(() => screen.getByText(/Total: 40 m/i));
    expect(screen.getByText(/2 rolls/i)).toBeTruthy();
    expect(onStockChanged).toHaveBeenCalledWith("40.000", 2);
  });
});
