import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrderItemsSection from "@/components/pages/order/OrderItemsSection";
import { packingApi } from "@/lib/api/order";
import type { OrderItem, PackLineResponse, PackingBundle } from "@/types/order";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const roleRef = vi.hoisted(() => ({ current: "ADMIN" }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ role: roleRef.current }),
}));

vi.mock("@/lib/api/item", () => ({
  fabricApi: { getOutstandingDemand: vi.fn() },
  // A colour tracked by physical rolls is packed by scanning its label; these
  // lines have none, so the scanner is stood in for rather than opened.
  rollApi: { preview: vi.fn(), getForVariant: vi.fn() },
}));

vi.mock("@/components/items/QRScanModal", () => ({ default: () => null }));

// The real preview pulls in next/image, which jsdom will not render here.
vi.mock("@/components/pages/ImagePreview", () => ({
  ImagePreview: ({ src, alt }: { src: string; alt?: string }) => (
    <span data-testid="fabric-thumb" data-src={src} aria-label={alt} />
  ),
}));

vi.mock("@/lib/api/order", () => ({
  packingApi: {
    packLine: vi.fn(),
    listBundles: vi.fn().mockResolvedValue([]),
    createBundle: vi.fn(),
    scanIntoBundle: vi.fn(),
    removeRollFromBundle: vi.fn(),
    sealBundle: vi.fn(),
    cancelBundle: vi.fn(),
  },
  orderApi: { deleteItem: vi.fn(), updateItem: vi.fn() },
}));

// Imported after the mocks above so the component picks them up.
import { fabricApi, rollApi } from "@/lib/api/item";

const packLine = vi.mocked(packingApi.packLine);
const listBundles = vi.mocked(packingApi.listBundles);
const getOutstandingDemand = vi.mocked(fabricApi.getOutstandingDemand);
const preview = vi.mocked(rollApi.preview);

/** A sealed bundle that packed `metres` of line `item`. */
function sealedBundle(
  item: number,
  metres: string,
  overrides: Partial<PackingBundle> = {},
): PackingBundle {
  const rate = "9.00";
  const value = (Number(metres) * Number(rate)).toFixed(2);
  return {
    id: 1,
    number: 1,
    code: "Order #5 -- Bundle 1",
    status: "SEALED",
    created_at: "2026-02-01T09:00:00Z",
    sealed_at: "2026-02-01T11:00:00Z",
    created_by: "admin1",
    order: 5,
    order_number: 5,
    customer: "Riya Textiles",
    customer_address: "14 Mill Lane",
    rolls: [
      {
        id: 11,
        roll: 3,
        roll_number: "NAT-0001",
        colour: "Natural",
        fabric: "Cotton Cambric",
        metres,
        item,
        fabric_name: "Cotton Cambric",
        variant_display_order: "Natural",
        rate_per_meter: rate,
        value,
        round: 42,
        scanned_at: "2026-02-01T10:00:00Z",
      },
    ],
    roll_count: 1,
    total_metres: metres,
    total_value: value,
    ...overrides,
  };
}

const lineA: OrderItem = {
  id: 7,
  fabric: 1,
  variant: 3,
  variant_display_order: "Natural",
  fabric_name: "Cotton Cambric",
  fabric_name_display: "Cotton Cambric",
  rate_per_meter: "9.00",
  original_rate_per_meter: "9.00",
  is_rate_overridden: false,
  rate_overridden_by: null,
  rate_overridden_at: null,
  variant_image: null,
  ordered_quantity: "600.000",
  allocated_quantity: "0.000",
  outstanding_quantity: "600.000",
  line_total: "5400.00",
  allocation_count: 0,
  is_roll_tracked: false,
};

const lineB: OrderItem = {
  id: 8,
  fabric: 2,
  variant: 4,
  variant_display_order: "Charcoal",
  fabric_name: "Linen Blend",
  fabric_name_display: "Linen Blend",
  rate_per_meter: "12.00",
  original_rate_per_meter: "12.00",
  is_rate_overridden: false,
  rate_overridden_by: null,
  rate_overridden_at: null,
  variant_image: null,
  ordered_quantity: "400.000",
  allocated_quantity: "0.000",
  outstanding_quantity: "400.000",
  line_total: "4800.00",
  allocation_count: 0,
  is_roll_tracked: false,
};

const aResult: PackLineResponse = {
  message: "Packed 600 m",
  round: 51,
  order: 5,
  order_status: "PENDING",
  item: { ...lineA, allocated_quantity: "600.000", outstanding_quantity: "0.000", allocation_count: 1 },
  stock_meters: "1800.000",
};

/** A line ordered 50 m that came off the roll as 55 m. */
const overLine: OrderItem = { ...lineA, ordered_quantity: "50.000" };
const overResult: PackLineResponse = {
  message: "Packed 55 m of Cotton Cambric",
  round: 52,
  order: 5,
  order_status: "PACKED",
  item: { ...overLine, allocated_quantity: "55.000", outstanding_quantity: "0.000", allocation_count: 1 },
  stock_meters: "2345.000",
};

const inputFor = (name: RegExp) =>
  screen.getByLabelText(name) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  roleRef.current = "ADMIN";
  getOutstandingDemand.mockResolvedValue([
    { variant: 3, stock_meters: "2400.000" },
    { variant: 4, stock_meters: "500.000" },
  ] as never);
  // No breakdown to offer, so the packing rows stay as they were.
  preview.mockResolvedValue({
    rolls: [],
    requested_meters: "0.000",
    covered_meters: "0.000",
    shortfall_meters: "0.000",
    available_meters: "0.000",
  });
});

function section() {
  return render(
    <OrderItemsSection
      items={[lineA, lineB]}
      status="PENDING"
      orderId={5}
      onItemsChange={vi.fn()}
    />,
  );
}

describe("OrderItemsSection line packing", () => {
  it("has no whole-order packing toggle any more", () => {
    section();

    // Packing moved to the bundle above the lines, so nothing switches the lines
    // into an editable state first.
    expect(screen.queryByRole("button", { name: /update packing/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^done$/i })).toBeNull();
  });

  it("shows a pack box on every line straight away", () => {
    section();

    expect(inputFor(/metres of cotton cambric to pack/i)).toBeTruthy();
    expect(inputFor(/metres of linen blend to pack/i)).toBeTruthy();
    // One control per line, each packing itself.
    expect(screen.getAllByRole("button", { name: /pack this line/i })).toHaveLength(2);
  });

  it("prefills a line with what is already packed on it", () => {
    render(
      <OrderItemsSection
        items={[{ ...lineA, allocated_quantity: "250.000", outstanding_quantity: "350.000" }]}
        status="PENDING"
        orderId={5}
        onItemsChange={vi.fn()}
      />,
    );

    expect(inputFor(/metres of cotton cambric to pack/i).value).toBe("250");
  });

  it("prefills an unpacked line with what the roll can cover", async () => {
    section();

    await waitFor(() =>
      expect(inputFor(/metres of cotton cambric to pack/i).value).toBe("600"),
    );

    // Line B wants 400 m but its roll only holds 500, so both take their own
    // figure rather than a shared one.
    expect(inputFor(/metres of linen blend to pack/i).value).toBe("400");
  });

  it("packs one line without disturbing the figure typed into another", async () => {
    const user = userEvent.setup();
    packLine.mockResolvedValue(aResult);
    section();

    await waitFor(() =>
      expect(inputFor(/metres of cotton cambric to pack/i).value).toBe("600"),
    );

    // The admin starts typing a figure on the other line, then packs the first.
    const linenInput = inputFor(/metres of linen blend to pack/i);
    await user.clear(linenInput);
    await user.type(linenInput, "123");

    await user.click(screen.getAllByRole("button", { name: /pack this line/i })[0]);

    await waitFor(() => expect(packLine).toHaveBeenCalledWith(5, 7, "600"));
    // Only line A was packed, and line B keeps what was typed into it.
    expect(packLine).toHaveBeenCalledTimes(1);
    expect(inputFor(/metres of linen blend to pack/i).value).toBe("123");
  });

  it("takes a finished line out of the list and shows it under the bundles", async () => {
    const user = userEvent.setup();
    packLine.mockResolvedValue(aResult);
    section();

    await waitFor(() =>
      expect(inputFor(/metres of cotton cambric to pack/i).value).toBe("600"),
    );
    await user.click(screen.getAllByRole("button", { name: /pack this line/i })[0]);

    // Nothing is owed on line A any more, so it is no longer work to do and the
    // list stops carrying it. It has not gone missing: it is with the bundles.
    await waitFor(() =>
      expect(screen.queryByLabelText(/metres of cotton cambric to pack/i)).toBeNull(),
    );
    // Only the line still owing something keeps its packing box.
    expect(screen.getAllByRole("button", { name: /pack this line/i })).toHaveLength(1);
    expect(screen.getByText("Packed without a bundle")).toBeTruthy();
    expect(screen.getByText(/600 m packed by hand/)).toBeTruthy();
    // The order header still counts what was packed.
    expect(screen.getByText("1000 m ordered · 600 m packed")).toBeTruthy();
  });

it("leaves the list once a line is packed and keeps the order total honest", async () => {
    const user = userEvent.setup();
    packLine.mockResolvedValue(aResult);
    section();

    await waitFor(() =>
      expect(inputFor(/metres of cotton cambric to pack/i).value).toBe("600"),
    );
    await user.click(screen.getAllByRole("button", { name: /pack this line/i })[0]);

    // The line is settled, so it belongs with the bundles now.
    await waitFor(() =>
      expect(screen.queryByLabelText(/metres of cotton cambric to pack/i)).toBeNull(),
    );
    expect(screen.getByText(/600 m packed by hand/)).toBeTruthy();
    // The header is worked out from every line, so it still reads true.
    expect(screen.getByText("1000 m ordered · 600 m packed")).toBeTruthy();
  });

  it("offers no packing controls on a dispatched order", () => {
    render(
      <OrderItemsSection
        items={[lineA, lineB]}
        status="DISPATCHED"
        orderId={5}
        onItemsChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /pack this line/i })).toBeNull();
    expect(screen.queryByLabelText(/metres of .* to pack/i)).toBeNull();
  });

  it("offers no packing controls to a non-admin", () => {
    roleRef.current = "AGENT";
    section();

    expect(screen.queryByRole("button", { name: /pack this line/i })).toBeNull();
    expect(screen.queryByLabelText(/metres of .* to pack/i)).toBeNull();
  });
});

describe("OrderItemsSection over-packed quantities", () => {
  it("shows the metres actually packed when a line is packed past its order", async () => {
    const user = userEvent.setup();
    packLine.mockResolvedValue(overResult);
    render(
      <OrderItemsSection
        items={[overLine]}
        status="PENDING"
        orderId={5}
        onItemsChange={vi.fn()}
      />,
    );

    const input = inputFor(/metres of cotton cambric to pack/i);
    await user.clear(input);
    await user.type(input, "55");
    await user.click(screen.getByRole("button", { name: /pack this line/i }));

    await waitFor(() => expect(packLine).toHaveBeenCalledWith(5, 7, "55"));

    // The line and the order header both report the real 55 m, not the 50 m
    // that were ordered. The line itself has left the list -- it is settled -- so
    // the metres are read off it where it now sits.
    await waitFor(() => expect(screen.getByText(/55 m packed by hand/)).toBeTruthy());
    expect(screen.getByText("50 m ordered · 55 m packed")).toBeTruthy();
  });

  it("never shows a negative still-owed figure after an over-pack", async () => {
    const user = userEvent.setup();
    packLine.mockResolvedValue(overResult);
    render(
      <OrderItemsSection
        items={[overLine]}
        status="PENDING"
        orderId={5}
        onItemsChange={vi.fn()}
      />,
    );

    const input = inputFor(/metres of cotton cambric to pack/i);
    await user.clear(input);
    await user.type(input, "55");
    await user.click(screen.getByRole("button", { name: /pack this line/i }));

    await waitFor(() =>
      expect(screen.queryByLabelText(/metres of cotton cambric to pack/i)).toBeNull(),
    );
    // A line past its order is settled, so there is no negative shortfall to show.
    expect(screen.queryByText(/-5 m still owed/i)).toBeNull();
    expect(screen.queryByText(/still owed/i)).toBeNull();
  });

  it("notes the surplus on an over-packed line", async () => {
    const user = userEvent.setup();
    packLine.mockResolvedValue(overResult);
    render(
      <OrderItemsSection
        items={[overLine]}
        status="PENDING"
        orderId={5}
        onItemsChange={vi.fn()}
      />,
    );

    const input = inputFor(/metres of cotton cambric to pack/i);
    await user.clear(input);
    await user.type(input, "55");
    await user.click(screen.getByRole("button", { name: /pack this line/i }));

    // The surplus would have been noted on the line's own packing row, which the
    // line has now left -- so it is carried with the line instead of being lost.
    await waitFor(() => expect(screen.getByText(/\+5 m over ordered/)).toBeTruthy());
  });

  it("shows no surplus note on a line packed exactly", async () => {
    const user = userEvent.setup();
    packLine.mockResolvedValue({
      ...overResult,
      item: { ...overLine, allocated_quantity: "50.000", outstanding_quantity: "0.000" },
    });
    render(
      <OrderItemsSection
        items={[overLine]}
        status="PENDING"
        orderId={5}
        onItemsChange={vi.fn()}
      />,
    );

    const input = inputFor(/metres of cotton cambric to pack/i);
    await user.clear(input);
    await user.type(input, "50");
    await user.click(screen.getByRole("button", { name: /pack this line/i }));

    await waitFor(() => expect(screen.getByText(/50 m packed by hand/)).toBeTruthy());
    expect(screen.queryByText(/over ordered/i)).toBeNull();
  });

  it("pre-fills the box with the metres actually packed", async () => {
    const user = userEvent.setup();
    packLine.mockResolvedValue({
      ...overResult,
      order_status: "PENDING",
      item: { ...overLine, allocated_quantity: "49.000", outstanding_quantity: "1.000" },
    });
    render(
      <OrderItemsSection
        items={[overLine]}
        status="PENDING"
        orderId={5}
        onItemsChange={vi.fn()}
      />,
    );

    const input = inputFor(/metres of cotton cambric to pack/i);
    await user.clear(input);
    await user.type(input, "49");
    await user.click(screen.getByRole("button", { name: /pack this line/i }));

    // One metre is still owed, so the line keeps its box -- and the box settles on
    // the 49 m already stored rather than the 50 m ordered.
    await waitFor(() => expect(input.value).toBe("49"));
    expect(screen.getByText("1 m still owed")).toBeTruthy();
  });

  it("shows the packed metres and the shortfall on a part-packed line", async () => {
    const user = userEvent.setup();
    packLine.mockResolvedValue({
      ...overResult,
      order_status: "PENDING",
      item: { ...overLine, allocated_quantity: "49.000", outstanding_quantity: "1.000" },
    });
    render(
      <OrderItemsSection
        items={[overLine]}
        status="PENDING"
        orderId={5}
        onItemsChange={vi.fn()}
      />,
    );

    const input = inputFor(/metres of cotton cambric to pack/i);
    await user.clear(input);
    await user.type(input, "49");
    await user.click(screen.getByRole("button", { name: /pack this line/i }));

    await waitFor(() => expect(screen.getByText("49 m packed")).toBeTruthy());
    expect(screen.getByText("1 m still owed")).toBeTruthy();
    expect(screen.getByText("50 m ordered · 49 m packed")).toBeTruthy();
  });

  it("hands the packed line up so the page totals are not left stale", async () => {
    const user = userEvent.setup();
    packLine.mockResolvedValue(overResult);
    // The page works its "N m packed" footer and dispatch figure out of the items
    // it last fetched, so a pack has to reach it or it keeps advertising the
    // pre-pack metres.
    const onItemsChange = vi.fn();
    render(
      <OrderItemsSection
        items={[overLine]}
        status="PENDING"
        orderId={5}
        onItemsChange={onItemsChange}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /pack this line/i })).toBeTruthy(),
    );
    await user.click(screen.getByRole("button", { name: /pack this line/i }));

    await waitFor(() => expect(onItemsChange).toHaveBeenCalled());
  });
});

/**
 * A line packing has finished is not work in progress, so it leaves the list of
 * lines still to pack and is shown against the box that carried it. A line with
 * metres still owing it stays in the list and is also shown under whichever box
 * has already packed part of it, until the last metre moves.
 */
describe("OrderItemsSection packed lines moving under their bundle", () => {
  it("takes a finished line out of the list and shows it under its bundle", async () => {
    const user = userEvent.setup();
    // Line A is packed to the metre by the bundle; line B is untouched.
    listBundles.mockResolvedValue([sealedBundle(7, "600.000")]);
    render(
      <OrderItemsSection
        items={[
          { ...lineA, allocated_quantity: "600.000", outstanding_quantity: "0.000" },
          lineB,
        ]}
        status="PACKED"
        orderId={5}
        onItemsChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(listBundles).toHaveBeenCalled());
    // Nothing is owed on line A, so it is no longer in the list of lines to pack.
    expect(screen.queryByLabelText(/metres of cotton cambric to pack/i)).toBeNull();
    // Line B is untouched, so it is still there.
    expect(screen.getByLabelText(/metres of linen blend to pack/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /lines packed/i }));

    // Line A is with the box that packed it, showing that box's own metres.
    expect(screen.getByText(/600 m packed in this bundle/)).toBeTruthy();
    expect(screen.getByText("₹5,400")).toBeTruthy();
    // It was packed in a box, so it is not also reported as hand-packed.
    expect(screen.queryByText("Packed without a bundle")).toBeNull();
  });

  it("keeps a part-packed line in the list and shows its packed portion too", async () => {
    const user = userEvent.setup();
    // One box has packed 400 m of line A's 600, leaving 200 m to come.
    listBundles.mockResolvedValue([sealedBundle(7, "400.000")]);
    render(
      <OrderItemsSection
        items={[
          {
            ...lineA,
            allocated_quantity: "400.000",
            outstanding_quantity: "200.000",
          },
          lineB,
        ]}
        status="PACKED"
        orderId={5}
        onItemsChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(listBundles).toHaveBeenCalled());

    // Still owed something, so it stays in the list with its true figures.
    expect(screen.getByLabelText(/metres of cotton cambric to pack/i)).toBeTruthy();
    expect(screen.getByText("600 m ordered")).toBeTruthy();
    expect(screen.getByText("200 m awaiting packing")).toBeTruthy();
    expect(screen.queryByText(/fully packed/)).toBeNull();

    // And what the box already packed is shown against that box.
    await user.click(screen.getByRole("button", { name: /lines packed/i }));
    expect(screen.getByText(/400 m packed in this bundle/)).toBeTruthy();
    expect(screen.queryByText(/600 m packed in this bundle/)).toBeNull();
  });

  it("says so when there is nothing left to pack", async () => {
    listBundles.mockResolvedValue([
      sealedBundle(7, "600.000"),
      sealedBundle(8, "400.000", {
        id: 2,
        number: 2,
        code: "Order #5 -- Bundle 2",
      }),
    ]);
    render(
      <OrderItemsSection
        items={[
          { ...lineA, allocated_quantity: "600.000", outstanding_quantity: "0.000" },
          { ...lineB, allocated_quantity: "400.000", outstanding_quantity: "0.000" },
        ]}
        status="PACKED"
        orderId={5}
        onItemsChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(listBundles).toHaveBeenCalled());

    // Every line is settled, so an empty list would just look broken.
    expect(screen.getByText(/All items packed/)).toBeTruthy();
    expect(screen.queryByLabelText(/metres of .* to pack/i)).toBeNull();
    // The bundles are still there to say where the cloth went.
    expect(screen.getByText("Sealed bundles")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /lines packed/i })).toHaveLength(2);
  });

  it("leaves the list whole for a viewer who cannot see the bundles", () => {
    roleRef.current = "AGENT";
    render(
      <OrderItemsSection
        items={[{ ...lineA, allocated_quantity: "600.000", outstanding_quantity: "0.000" }]}
        status="PACKED"
        orderId={5}
        onItemsChange={vi.fn()}
      />,
    );

    // Without the bundles on screen there is nowhere for a settled line to be
    // shown, so nothing is taken away from this view.
    expect(screen.getByText(/Cotton Cambric/)).toBeTruthy();
    expect(screen.getByText(/fully packed/)).toBeTruthy();
  });
});
