import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import PackingBundlePanel from "@/components/pages/order/PackingBundlePanel";
import { packingApi } from "@/lib/api/order";
import type { PackingBundle, PackingBundleRoll } from "@/types/order";

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