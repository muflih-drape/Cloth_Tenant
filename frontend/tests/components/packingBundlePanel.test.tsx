import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import PackingBundlePanel from "@/components/pages/order/PackingBundlePanel";
import { packingApi } from "@/lib/api/order";
import type {
  OrderItem,
  PackingBundle,
  PackingBundleRoll,
} from "@/types/order";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/api/order", () => ({
  packingApi: {
    listBundles: vi.fn(),
    createBundle: vi.fn(),
    scanIntoBundle: vi.fn(),
    removeRollFromBundle: vi.fn(),
    sealBundle: vi.fn(),
    cancelBundle: vi.fn(),
  },
}));

/**
 * The slip is a real PDF document, so the renderer is stood in for here: what is
 * being tested is when the panel produces one, not what a PDF looks like.
 */
const pdfMock = vi.fn<
  (...args: unknown[]) => Promise<{ toBlob: () => Promise<Blob> }>
>();
vi.mock("@react-pdf/renderer", async () => {
  const actual = await vi.importActual<typeof import("@react-pdf/renderer")>(
    "@react-pdf/renderer",
  );
  return { ...actual, pdf: (doc: unknown) => pdfMock(doc) };
});

/**
 * The camera is not under test, so the scanner is stood in for by a box with a
 * "scan" button: it feeds `onScan` whatever is typed, exactly as the real modal
 * feeds it whatever the QR decodes to.
 */
// The real preview pulls in next/image, which needs a URL this file stubs away.
vi.mock("@/components/pages/ImagePreview", () => ({
  ImagePreview: ({ src, alt }: { src: string; alt?: string }) => (
    <span data-testid="fabric-thumb" data-src={src} aria-label={alt} />
  ),
}));

vi.mock("@/components/items/QRScanModal", () => ({
  default: function StubScanner({
    isOpen,
    onClose,
    onScan,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onScan: (raw: string) => void;
  }) {
    const [value, setValue] = useState("");
    if (!isOpen) return null;
    return (
      <div>
        <input
          aria-label="Stub scanner input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="button" onClick={() => onScan(value.trim())}>
          scan
        </button>
        <button type="button" onClick={onClose}>
          close scanner
        </button>
      </div>
    );
  },
}));

const listBundles = vi.mocked(packingApi.listBundles);
const createBundle = vi.mocked(packingApi.createBundle);
const scanIntoBundle = vi.mocked(packingApi.scanIntoBundle);
const removeRollFromBundle = vi.mocked(packingApi.removeRollFromBundle);
const sealBundle = vi.mocked(packingApi.sealBundle);
const cancelBundle = vi.mocked(packingApi.cancelBundle);

function roll(overrides: Partial<PackingBundleRoll> = {}): PackingBundleRoll {
  return {
    id: 11,
    roll: 3,
    roll_number: "NAT-0001",
    colour: "Natural",
    fabric: "Cotton Cambric 140 GSM",
    metres: "600.000",
    item: 7,
    fabric_name: "Cotton Cambric 140 GSM",
    variant_display_order: "Natural",
    rate_per_meter: "9.00",
    value: "5400.00",
    round: 42,
    scanned_at: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

function bundle(overrides: Partial<PackingBundle> = {}): PackingBundle {
  const rolls = overrides.rolls ?? [];
  return {
    id: 1,
    number: 1,
    code: "Order #5 -- Bundle 1",
    status: "OPEN",
    created_at: "2026-02-01T09:00:00Z",
    sealed_at: null,
    created_by: "admin1",
    order: 5,
    order_number: 5,
    customer: "Riya Textiles",
    customer_address: "14 Mill Lane",
    rolls,
    roll_count: rolls.length,
    total_metres: rolls.reduce((sum, r) => sum + Number(r.metres), 0).toFixed(3),
    total_value: rolls
      .reduce((sum, r) => sum + Number(r.value), 0)
      .toFixed(2),
    ...overrides,
  };
}

function panel(props: Partial<React.ComponentProps<typeof PackingBundlePanel>> = {}) {
  const { onChanged = vi.fn(), onOrderStatusChange = vi.fn(), ...rest } = props;
  return render(
    <PackingBundlePanel
      orderId={5}
      enabled
      {...rest}
      onChanged={onChanged}
      onOrderStatusChange={onOrderStatusChange}
    />,
  );
}

const createButton = () =>
  screen.getByRole("button", { name: /create bundle/i });
const scanButton = () =>
  screen.getByRole("button", { name: /scan a roll into this bundle/i });
const sealButton = () =>
  screen.getByRole("button", { name: /complete bundle/i });

/** Types into the stubbed scanner and fires it, as scanning a label would. */
async function scan(user: ReturnType<typeof userEvent.setup>, value: string) {
  const box = await screen.findByLabelText("Stub scanner input");
  await user.clear(box);
  if (value) await user.type(box, value);
  await user.click(screen.getByRole("button", { name: /^scan$/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  pdfMock.mockImplementation(async () => ({
    toBlob: async () => new Blob(["pdf"]),
  }));
  listBundles.mockResolvedValue([]);
  // jsdom has no object-URL support; the panel only needs it to not throw.
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:stub",
    revokeObjectURL: () => {},
  });
});

describe("PackingBundlePanel", () => {
  it("offers Create bundle on an order with nothing packed into a box yet", async () => {
    panel();

    await waitFor(() => expect(listBundles).toHaveBeenCalledWith(5));
    expect(createButton()).toBeTruthy();
    expect(
      screen.getByText(/scan whole rolls into a box/i),
    ).toBeTruthy();
  });

  it("offers no bundle controls at all once the order is out of reach", async () => {
    panel({ enabled: false });

    await waitFor(() => expect(listBundles).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /create bundle/i })).toBeNull();
  });

  it("opens a bundle and puts the scanner straight up", async () => {
    const user = userEvent.setup();
    createBundle.mockResolvedValue({
      message: "Opened Order #5 -- Bundle 1",
      bundle: bundle(),
    });
    panel();

    await user.click(createButton());

    await waitFor(() => expect(createBundle).toHaveBeenCalledWith(5));
    // Scanning a box is a run of scans, so the scanner opens with the bundle.
    expect(await screen.findByLabelText("Stub scanner input")).toBeTruthy();
    expect(scanButton()).toBeTruthy();
    expect(
      screen.getByText(/Order #5 -- Bundle 1 is open · 0 rolls/i),
    ).toBeTruthy();
  });

  it("cuts the scanned roll in without the packer choosing a line", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    const onOrderStatusChange = vi.fn();
    scanIntoBundle.mockResolvedValue({
      message: "Added roll NAT-0001 (600 m) to Order #5 -- Bundle 1",
      item_id: 7,
      fabric_name: "Cotton Cambric 140 GSM",
      variant_display_order: "Natural",
      order_status: "PACKED",
      bundle: bundle({ rolls: [roll()], total_metres: "600.000", total_value: "5400.00" }),
    });
    panel({ onChanged, onOrderStatusChange });

    await user.click(createButton());
    await scan(user, "3");

    // Only the roll and the bundle are named: the colour on the roll picks the line.
    await waitFor(() => expect(scanIntoBundle).toHaveBeenCalledWith(5, 1, 3));
    expect(onChanged).toHaveBeenCalled();
    expect(onOrderStatusChange).toHaveBeenCalledWith("PACKED");
    expect(await screen.findByText("NAT-0001")).toBeTruthy();
    expect(screen.getByText(/1 roll · 600 m/)).toBeTruthy();
  });

  it("keeps the scanner open so a box can be filled in one run", async () => {
    const user = userEvent.setup();
    scanIntoBundle.mockResolvedValue({
      message: "Added roll NAT-0001 (600 m) to Order #5 -- Bundle 1",
      item_id: 7,
      fabric_name: "Cotton Cambric 140 GSM",
      variant_display_order: "Natural",
      order_status: "PENDING",
      bundle: bundle({ rolls: [roll()], total_metres: "600.000" }),
    });
    panel();

    await user.click(createButton());
    await scan(user, "3");

    // Still open: the next roll is picked up and scanned straight away.
    expect(screen.getByLabelText("Stub scanner input")).toBeTruthy();
  });

  it("refuses a QR that is not a roll label, without calling the API", async () => {
    const user = userEvent.setup();
    panel();

    await user.click(createButton());
    await scan(user, "3f2504e0-4f89-11d3-9a0c-0305e82c3301");

    expect(toast.error).toHaveBeenCalledWith(
      "That is not a roll label",
      expect.objectContaining({
        description:
          "Roll labels carry a plain number. Scan the label on the roll itself.",
      }),
    );
    expect(scanIntoBundle).not.toHaveBeenCalled();
  });

  it("keeps the scanner open when the server refuses the roll", async () => {
    const user = userEvent.setup();
    scanIntoBundle.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: "Order #5 has no line for Linen 200 GSM (Ivory).",
        },
      },
    });
    panel();

    await user.click(createButton());
    await scan(user, "9");

    // The packer most likely grabbed the wrong roll, so the fix is to scan again.
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Order #5 has no line for Linen 200 GSM (Ivory). (HTTP 400)",
        { duration: 3000 },
      ),
    );
    expect(screen.getByLabelText("Stub scanner input")).toBeTruthy();
  });

  it("takes one roll back out and leaves the rest of the box alone", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    listBundles.mockResolvedValue([
      bundle({
        rolls: [roll(), roll({ id: 12, roll: 4, roll_number: "NAT-0002" })],
        total_metres: "1000.000",
      }),
    ]);
    removeRollFromBundle.mockResolvedValue({
      message: "Removed roll NAT-0001 from Order #5 -- Bundle 1",
      order_status: "PENDING",
      bundle: bundle({
        rolls: [roll({ id: 12, roll: 4, roll_number: "NAT-0002" })],
        total_metres: "400.000",
      }),
    });
    panel({ onChanged });

    // Two rolls, so the button has to be asked for by roll rather than by role.
    const row = (await screen.findByText("NAT-0001")).closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /remove from bundle/i }));

    // Named by the bundle entry, not the roll, so one of two is removable alone.
    await waitFor(() =>
      expect(removeRollFromBundle).toHaveBeenCalledWith(5, 1, 11),
    );
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByText("NAT-0001")).toBeNull();
    expect(screen.getByText("NAT-0002")).toBeTruthy();
  });

  it("sealing closes the box and downloads its packing slip at once", async () => {
    const user = userEvent.setup();
    listBundles.mockResolvedValue([bundle({ rolls: [roll()], total_metres: "600.000" })]);
    sealBundle.mockResolvedValue({
      message: "Order #5 -- Bundle 1 sealed. It can no longer be changed.",
      bundle: bundle({
        rolls: [roll()],
        status: "SEALED",
        sealed_at: "2026-02-01T11:00:00Z",
        total_metres: "600.000",
      }),
    });
    panel();

    await user.click(await screen.findByRole("button", { name: /complete bundle/i }));

    await waitFor(() => expect(sealBundle).toHaveBeenCalledWith(5, 1));
    // The slip is produced on the spot rather than left as a job to remember.
    await waitFor(() => expect(pdfMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByText(/sealed and its packing slip has been downloaded/i)).toBeTruthy(),
    );
  });

  it("will not seal an empty bundle", async () => {
    listBundles.mockResolvedValue([bundle()]);
    panel();

    await waitFor(() => expect(listBundles).toHaveBeenCalled());
    await userEvent.setup().click(sealButton());

    expect(sealBundle).not.toHaveBeenCalled();
  });

  it("keeps sealed bundles listed so a lost slip can be downloaded again", async () => {
    const user = userEvent.setup();
    listBundles.mockResolvedValue([
      bundle({ rolls: [roll()], status: "SEALED", sealed_at: "2026-02-01T11:00:00Z", total_metres: "600.000" }),
    ]);
    panel();

    await waitFor(() => expect(listBundles).toHaveBeenCalled());
    expect(screen.getByText(/1 sealed bundle on this order/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /download slip/i }));

    await waitFor(() => expect(pdfMock).toHaveBeenCalledTimes(1));
    // And printing is offered too, from the same sealed record.
    expect(screen.getByRole("button", { name: /print slip/i })).toBeTruthy();
  });

  it("cancels a bundle only after the admin confirms the rolls go back", async () => {
    const user = userEvent.setup();
    listBundles.mockResolvedValue([bundle({ rolls: [roll()], total_metres: "600.000" })]);
    cancelBundle.mockResolvedValue({
      message: "Cancelled Order #5 -- Bundle 1 and returned 1 roll.",
      order_status: "PENDING",
      bundle: bundle({ status: "CANCELLED" }),
    });
    panel();

    await user.click(await screen.findByRole("button", { name: /^cancel bundle$/i }));

    // Asking is not doing: the first click only spells out what will happen.
    expect(cancelBundle).not.toHaveBeenCalled();
    expect(screen.getByText(/kept as a record/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /give every roll back/i }));

    await waitFor(() => expect(cancelBundle).toHaveBeenCalledWith(5, 1));
    // An empty bundle is discarded rather than left hanging open on the order.
    expect(screen.queryByRole("button", { name: /scan a roll into this bundle/i })).toBeNull();
  });

  it("can keep a bundle after being asked to cancel it", async () => {
    const user = userEvent.setup();
    listBundles.mockResolvedValue([bundle({ rolls: [roll()], total_metres: "600.000" })]);
    panel();

    await user.click(await screen.findByRole("button", { name: /^cancel bundle$/i }));
    await user.click(screen.getByRole("button", { name: /keep bundle/i }));

    expect(cancelBundle).not.toHaveBeenCalled();
    expect(screen.queryByText(/kept as a record/i)).toBeNull();
    expect(scanButton()).toBeTruthy();
  });
});

/**
 * An order's cloth does not always leave in one box: rolls are packed across
 * several bundles, whether that is several boxes or several sessions on different
 * days. So sealing a bundle has to leave the next one available on the same
 * order, and every bundle has to keep its own contents and its own slip.
 */
describe("PackingBundlePanel packing a second bundle", () => {
  const firstRoll = roll({ id: 11, roll: 3, roll_number: "NAT-0001", metres: "600.000" });
  const secondRoll = roll({ id: 12, roll: 4, roll_number: "NAT-0002", metres: "400.000" });

  const bundleOne = bundle({
    id: 1,
    number: 1,
    code: "Order #5 -- Bundle 1",
    status: "OPEN",
    rolls: [firstRoll],
    roll_count: 1,
    total_metres: "600.000",
  });
  const bundleTwo = bundle({
    id: 2,
    number: 2,
    code: "Order #5 -- Bundle 2",
    status: "OPEN",
    rolls: [secondRoll],
    roll_count: 1,
    total_metres: "400.000",
  });
  const sealedOne = bundle({
    ...bundleOne,
    status: "SEALED",
    sealed_at: "2026-02-01T11:00:00Z",
  });
  const sealedTwo = bundle({
    ...bundleTwo,
    status: "SEALED",
    sealed_at: "2026-02-01T16:00:00Z",
  });

  /** Seal whatever bundle is open, as the server would answer. */
  function sealAnswer(sealed: PackingBundle) {
    sealBundle.mockResolvedValue({
      message: `${sealed.code} sealed. It can no longer be changed.`,
      bundle: sealed,
    });
  }

  it("offers Create bundle again once the first box is sealed", async () => {
    const user = userEvent.setup();
    listBundles.mockResolvedValue([bundleOne]);
    sealAnswer(sealedOne);
    createBundle.mockResolvedValue({
      message: "Opened Order #5 -- Bundle 2",
      bundle: bundleTwo,
    });
    panel();

    await waitFor(() => expect(listBundles).toHaveBeenCalledWith(5));
    // While a box is open there is nothing to create: one box at a time.
    expect(screen.queryByRole("button", { name: /create bundle/i })).toBeNull();

    await user.click(screen.getByRole("button", { name: /complete bundle/i }));
    await waitFor(() => expect(sealBundle).toHaveBeenCalledWith(5, 1));

    // Sealing closes the box, so the next one is there to be started.
    await waitFor(() => expect(createButton()).toBeTruthy());
    expect(screen.getByText(/1 sealed bundle on this order/i)).toBeTruthy();

    await user.click(createButton());

    await waitFor(() => expect(createBundle).toHaveBeenCalledWith(5));
    expect(
      await screen.findByText(/Order #5 -- Bundle 2 is open · 1 roll/i),
    ).toBeTruthy();
  });

  it("packs and seals a second box on the same order, keeping both", async () => {
    const user = userEvent.setup();
    listBundles.mockResolvedValue([sealedOne]);
    createBundle.mockResolvedValue({
      message: "Opened Order #5 -- Bundle 2",
      bundle: bundle({ ...bundleTwo, rolls: [], roll_count: 0, total_metres: "0.000" }),
    });
    scanIntoBundle.mockResolvedValue({
      message: "Added roll NAT-0002 (400 m) to Order #5 -- Bundle 2",
      item_id: 7,
      fabric_name: "Cotton Cambric 140 GSM",
      variant_display_order: "Natural",
      order_status: "PACKED",
      bundle: bundleTwo,
    });
    sealAnswer(sealedTwo);
    panel();

    await waitFor(() => expect(listBundles).toHaveBeenCalled());
    await user.click(createButton());
    await waitFor(() => expect(createBundle).toHaveBeenCalledWith(5));

    await scan(user, "4");
    await waitFor(() => expect(scanIntoBundle).toHaveBeenCalledWith(5, 2, 4));
    await waitFor(() => expect(screen.getByText("NAT-0002")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: /complete bundle/i }));
    await waitFor(() => expect(sealBundle).toHaveBeenCalledWith(5, 2));

    // Both boxes are on the order now, each with its own roll count, its own
    // metres and its own slip.
    await waitFor(() =>
      expect(screen.getByText(/2 sealed bundles on this order/i)).toBeTruthy(),
    );
    expect(screen.getByText("Order #5 -- Bundle 1")).toBeTruthy();
    expect(screen.getByText("Order #5 -- Bundle 2")).toBeTruthy();
    expect(screen.getByText(/1 roll · 600 m · 2026-02-01/)).toBeTruthy();
    expect(screen.getByText(/1 roll · 400 m · 2026-02-01/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /download slip/i })).toHaveLength(2);
  });

  it("reprints each sealed box's own slip, separately", async () => {
    const user = userEvent.setup();
    listBundles.mockResolvedValue([sealedOne, sealedTwo]);
    panel();

    await waitFor(() => expect(listBundles).toHaveBeenCalled());
    const slips = screen.getAllByRole("button", { name: /download slip/i });
    expect(slips).toHaveLength(2);

    await user.click(slips[1]);

    await waitFor(() => expect(pdfMock).toHaveBeenCalledTimes(1));
    // The document handed to the renderer carries the bundle it was asked for, so
    // the second box's sheet cannot print the first box's roll.
    const doc = pdfMock.mock.calls[0][0] as { props: { bundle: PackingBundle } };
    expect(doc.props.bundle.code).toBe("Order #5 -- Bundle 2");
    expect(doc.props.bundle.rolls.map((r) => r.roll_number)).toEqual(["NAT-0002"]);
  });

  it("does not offer to create a bundle while one is still open", async () => {
    listBundles.mockResolvedValue([bundleTwo, sealedOne]);
    panel();

    await waitFor(() => expect(listBundles).toHaveBeenCalled());

    // Bundle 2 is open, so there is no third box to start and no way to ask for
    // one from here: the open box is finished or cancelled first. The sealed one
    // stays on screen throughout.
    expect(screen.queryByRole("button", { name: /create bundle/i })).toBeNull();
    expect(screen.getByText(/Order #5 -- Bundle 2 is open/i)).toBeTruthy();
    expect(screen.getByText("Sealed bundles")).toBeTruthy();
    expect(screen.getByText("Order #5 -- Bundle 1")).toBeTruthy();
  });

  it("explains itself when the server refuses a second open box", async () => {
    const user = userEvent.setup();
    listBundles.mockResolvedValue([]);
    createBundle.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error:
            "Order #5 already has Order #5 -- Bundle 1 open. Seal or cancel it before opening another.",
        },
      },
    });
    panel();

    await waitFor(() => expect(listBundles).toHaveBeenCalled());
    await user.click(createButton());

    // The refusal names the box to finish, rather than failing silently.
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Seal or cancel it before opening another"),
        { duration: 3000 },
      ),
    );
    // And the way out is still on screen.
    expect(createButton()).toBeTruthy();
  });
});

/**
 * A fully packed line leaves the main list and is shown against the box that
 * carried it. The bundle is the record of the line's own last metres, so opening
 * it has to say which lines it packed, how much of each, and what that came to --
 * and only that box's share of a line, since one line's metres can be split over
 * several boxes.
 */
describe("PackingBundlePanel showing the lines a bundle packed", () => {
  /** An order line as the page holds it: the bundle names it only by id. */
  function line(overrides: Partial<OrderItem> = {}): OrderItem {
    return {
      id: 7,
      fabric: 1,
      variant: 3,
      variant_display_order: "Natural",
      fabric_name: "Cotton Cambric 140 GSM",
      fabric_name_display: "Cotton Cambric 140 GSM",
      rate_per_meter: "9.00",
      original_rate_per_meter: "9.00",
      is_rate_overridden: false,
      rate_overridden_by: null,
      rate_overridden_at: null,
      variant_image: "/media/variants/natural.jpg",
      ordered_quantity: "600.000",
      allocated_quantity: "600.000",
      outstanding_quantity: "0.000",
      line_total: "5400.00",
      allocation_count: 1,
      is_roll_tracked: true,
      ...overrides,
    };
  }

  const sealed = (overrides: Partial<PackingBundle> = {}) =>
    bundle({ status: "SEALED", sealed_at: "2026-02-01T11:00:00Z", ...overrides });

  it("shows a packed line under its bundle, with its own share of the metres", async () => {
    const user = userEvent.setup();
    listBundles.mockResolvedValue([
      sealed({
        rolls: [
          roll({ id: 11, roll: 3, roll_number: "NAT-0001", metres: "600.000", value: "5400.00" }),
        ],
        roll_count: 1,
        total_metres: "600.000",
      }),
    ]);
    panel({ items: [line()] });

    await waitFor(() => expect(listBundles).toHaveBeenCalled());
    // Closed to begin with, so the box is not just noise on the page.
    expect(screen.queryByText(/packed in this bundle/i)).toBeNull();

    await user.click(screen.getByRole("button", { name: /lines packed/i }));

    expect(screen.getByText(/Cotton Cambric 140 GSM/)).toBeTruthy();
    expect(screen.getByText(/\( Color #Natural \)/)).toBeTruthy();
    // The bundle's metres are the line's whole packed figure, so nothing is left
    // to report as hand-packed.
    expect(screen.queryByText("Packed without a bundle")).toBeNull();
    // The box's own 600 m, not the line's full 1000 m.
    expect(screen.getByText(/600 m packed in this bundle/)).toBeTruthy();
    // Priced on what this box contributed.
    expect(screen.getByText("₹5,400")).toBeTruthy();
    // The thumbnail comes from the order's own line, not from the bundle.
    expect(screen.getByTestId("fabric-thumb").getAttribute("data-src")).toBe(
      "/media/variants/natural.jpg",
    );
  });

  it("shows only the packed part of a line that still has metres owing", async () => {
    const user = userEvent.setup();
    listBundles.mockResolvedValue([
      sealed({
        rolls: [
          roll({ id: 11, roll: 3, roll_number: "NAT-0001", metres: "400.000", value: "3600.00" }),
        ],
        roll_count: 1,
        total_metres: "400.000",
      }),
    ]);
    // 1000 ordered, 400 packed so far: the rest is still outstanding.
    panel({
      items: [
        line({ allocated_quantity: "400.000", outstanding_quantity: "600.000" }),
      ],
    });

    await waitFor(() => expect(listBundles).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /lines packed/i }));

    // The bundle claims the 400 m it carried, and makes no claim on the rest.
    expect(screen.getByText(/400 m packed in this bundle/)).toBeTruthy();
    expect(screen.getByText("₹3,600")).toBeTruthy();
    // A line with metres still owing is not "packed without a bundle".
    expect(screen.queryByText("Packed without a bundle")).toBeNull();
  });

  it("reports each box's own share of a line split across two of them", async () => {
    const user = userEvent.setup();
    listBundles.mockResolvedValue([
      sealed({
        id: 1,
        number: 1,
        code: "Order #5 -- Bundle 1",
        rolls: [
          roll({ id: 11, roll: 3, roll_number: "NAT-0001", metres: "600.000", value: "5400.00" }),
        ],
        roll_count: 1,
        total_metres: "600.000",
      }),
      sealed({
        id: 2,
        number: 2,
        code: "Order #5 -- Bundle 2",
        rolls: [
          roll({ id: 12, roll: 4, roll_number: "NAT-0002", metres: "400.000", value: "3600.00" }),
        ],
        roll_count: 1,
        total_metres: "400.000",
      }),
    ]);
    panel({
      items: [
        // Both boxes together carry the line's whole 1000 m.
        line({
          ordered_quantity: "1000.000",
          allocated_quantity: "1000.000",
          outstanding_quantity: "0.000",
        }),
      ],
    });

    await waitFor(() => expect(listBundles).toHaveBeenCalled());
    const toggles = screen.getAllByRole("button", { name: /lines packed/i });
    expect(toggles).toHaveLength(2);

    // Open the first box: it answers for 600 m.
    await user.click(toggles[0]);
    expect(screen.getByText(/600 m packed in this bundle/)).toBeTruthy();
    expect(screen.getByText("₹5,400")).toBeTruthy();
    expect(screen.queryByText(/400 m packed in this bundle/)).toBeNull();

    // Opening the second does not disturb the first, and adds its own 400 m.
    await user.click(toggles[1]);
    expect(screen.getByText(/600 m packed in this bundle/)).toBeTruthy();
    expect(screen.getByText(/400 m packed in this bundle/)).toBeTruthy();
    expect(screen.getByText("₹3,600")).toBeTruthy();
  });

  it("adds up a line's share when a bundle carried several of its rolls", async () => {
    const user = userEvent.setup();
    listBundles.mockResolvedValue([
      sealed({
        rolls: [
          roll({ id: 11, roll: 3, roll_number: "NAT-0001", metres: "600.000", value: "5400.00" }),
          roll({ id: 12, roll: 4, roll_number: "NAT-0002", metres: "400.000", value: "3600.00" }),
        ],
        roll_count: 2,
        total_metres: "1000.000",
      }),
    ]);
    panel({
      items: [
        // One line, filled by both of the box's rolls.
        line({
          ordered_quantity: "1000.000",
          allocated_quantity: "1000.000",
          outstanding_quantity: "0.000",
        }),
      ],
    });

    await waitFor(() => expect(listBundles).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /lines packed/i }));

    // One line, one card, carrying both of the box's rolls.
    expect(screen.getByText(/1000 m packed in this bundle/)).toBeTruthy();
    expect(screen.getByText("₹9,000")).toBeTruthy();
    expect(screen.getAllByText(/Cotton Cambric 140 GSM/)).toHaveLength(1);
    expect(screen.getByText("NAT-0001, NAT-0002")).toBeTruthy();
  });

  it("opens and closes each box on its own", async () => {
    const user = userEvent.setup();
    listBundles.mockResolvedValue([
      sealed({ id: 1, number: 1, code: "Order #5 -- Bundle 1", rolls: [roll({ id: 11 })] }),
      sealed({ id: 2, number: 2, code: "Order #5 -- Bundle 2", rolls: [roll({ id: 12 })] }),
    ]);
    panel({ items: [line()] });

    await waitFor(() => expect(listBundles).toHaveBeenCalled());
    const [firstToggle, secondToggle] = screen.getAllByRole("button", {
      name: /lines packed/i,
    });
    expect(firstToggle.getAttribute("aria-expanded")).toBe("false");

    await user.click(firstToggle);
    expect(firstToggle.getAttribute("aria-expanded")).toBe("true");
    expect(secondToggle.getAttribute("aria-expanded")).toBe("false");

    // Closing one leaves the other alone.
    await user.click(secondToggle);
    expect(secondToggle.getAttribute("aria-expanded")).toBe("true");
    await user.click(firstToggle);
    expect(firstToggle.getAttribute("aria-expanded")).toBe("false");
    expect(secondToggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows the open box's lines too, with no slip to print yet", async () => {
    const user = userEvent.setup();
    listBundles.mockResolvedValue([
      bundle({
        status: "OPEN",
        rolls: [roll({ id: 11, roll: 3, roll_number: "NAT-0001", metres: "600.000", value: "5400.00" })],
        roll_count: 1,
        total_metres: "600.000",
      }),
    ]);
    panel({ items: [line({ allocated_quantity: "600.000", outstanding_quantity: "400.000" })] });

    await waitFor(() => expect(listBundles).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /lines packed/i }));

    expect(screen.getByText(/600 m packed in this bundle/)).toBeTruthy();
    // A box that can still change has no slip, so none is offered.
    expect(screen.queryByRole("button", { name: /^print slip$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^download slip$/i })).toBeNull();
  });

  it("collects metres packed without a bundle, and only those", async () => {
    listBundles.mockResolvedValue([
      sealed({
        rolls: [roll({ id: 11, roll: 3, metres: "600.000", value: "5400.00" })],
        roll_count: 1,
        total_metres: "600.000",
      }),
    ]);
    panel({
      items: [
        // Fully covered by the bundle above, so it belongs to that box.
        line({ id: 7, allocated_quantity: "600.000", outstanding_quantity: "0.000" }),
        // Packed by typing a figure, so no bundle ever recorded it.
        line({
          id: 8,
          fabric_name: "Linen Blend 200 GSM",
          variant_display_order: "Charcoal",
          allocated_quantity: "300.000",
          outstanding_quantity: "0.000",
        }),
        // Still owing something, so it is work in progress rather than settled.
        line({ id: 9, allocated_quantity: "100.000", outstanding_quantity: "400.000" }),
      ],
    });

    await waitFor(() => expect(listBundles).toHaveBeenCalled());
    expect(screen.getByText("Packed without a bundle")).toBeTruthy();
    // The hand-packed line, and the part of the unfinished line that was packed by
    // hand -- but not the bundle's line, which belongs to that box.
    expect(screen.getByText(/300 m packed by hand/)).toBeTruthy();
    expect(screen.getByText(/100 m packed by hand/)).toBeTruthy();
    expect(screen.queryByText(/600 m packed by hand/)).toBeNull();
  });

  it("counts a cancelled bundle for nothing, since its rolls went back", async () => {
    listBundles.mockResolvedValue([
      sealed({
        rolls: [roll({ id: 11, roll: 3, metres: "600.000", value: "5400.00" })],
        roll_count: 1,
        total_metres: "600.000",
      }),
      // A cancelled box is kept as a record, and this one still lists its roll.
      bundle({
        id: 3,
        number: 2,
        code: "Order #5 -- Bundle 2",
        status: "CANCELLED",
        rolls: [roll({ id: 12, roll: 4, metres: "400.000", value: "3600.00" })],
        roll_count: 1,
        total_metres: "400.000",
      }),
    ]);
    // 1000 m packed, of which 600 m are recorded against the box that still stands.
    panel({
      items: [
        line({ allocated_quantity: "1000.000", outstanding_quantity: "0.000" }),
      ],
    });

    await waitFor(() => expect(listBundles).toHaveBeenCalled());
    // Cancelling put the cancelled box's 400 m back on the order, so only 600 m
    // still stands against a bundle and the other 400 m reads as hand-packed.
    // Counting the cancelled box as well would leave nothing to report here.
    expect(screen.getByText(/400 m packed by hand/)).toBeTruthy();
  });
});