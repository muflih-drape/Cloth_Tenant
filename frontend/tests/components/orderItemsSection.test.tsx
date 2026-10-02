import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrderItemsSection from "@/components/pages/order/OrderItemsSection";
import { packingApi } from "@/lib/api/order";
import type { OrderItem, PackLineResponse } from "@/types/order";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const roleRef = vi.hoisted(() => ({ current: "ADMIN" }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ role: roleRef.current }),
}));

vi.mock("@/lib/api/item", () => ({
  fabricApi: { getOutstandingDemand: vi.fn() },
}));

vi.mock("@/lib/api/order", () => ({
  packingApi: { packLine: vi.fn() },
  orderApi: { deleteItem: vi.fn(), updateItem: vi.fn() },
}));

// Imported after the mocks above so the component picks them up.
import { fabricApi } from "@/lib/api/item";

const packLine = vi.mocked(packingApi.packLine);
const getOutstandingDemand = vi.mocked(fabricApi.getOutstandingDemand);

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

const openPacking = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /^update packing$/i }));
};

beforeEach(() => {
  vi.clearAllMocks();
  roleRef.current = "ADMIN";
  getOutstandingDemand.mockResolvedValue([
    { variant: 3, stock_meters: "2400.000" },
    { variant: 4, stock_meters: "500.000" },
  ] as never);
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

describe("OrderItemsSection packing mode", () => {
  it("shows one Update packing button for the whole order", async () => {
    section();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^update packing$/i })).toBeTruthy(),
    );
    // Exactly one, however many lines there are.
    expect(screen.getAllByRole("button", { name: /update packing/i })).toHaveLength(1);
  });

  it("hides the packing controls until the button is used", () => {
    section();

    // No per-line input, and no second yellow card behind the lines.
    expect(screen.queryByLabelText(/metres of .* to pack/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /pack this line/i })).toBeNull();
  });

  it("opens every line for editing at once and relabels the button Done", async () => {
    const user = userEvent.setup();
    section();

    await openPacking(user);

    expect(inputFor(/metres of cotton cambric to pack/i)).toBeTruthy();
    expect(inputFor(/metres of linen blend to pack/i)).toBeTruthy();
    // One control per line, each packing itself.
    expect(screen.getAllByRole("button", { name: /pack this line/i })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /^update packing$/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^done$/i })).toBeTruthy();
  });

  it("closes packing mode again on Done", async () => {
    const user = userEvent.setup();
    section();

    await openPacking(user);
    await user.click(screen.getByRole("button", { name: /^done$/i }));

    expect(screen.queryByLabelText(/metres of .* to pack/i)).toBeNull();
    expect(screen.getByRole("button", { name: /^update packing$/i })).toBeTruthy();
  });

  it("prefills a line with what is already packed on it", async () => {
    const user = userEvent.setup();
    render(
      <OrderItemsSection
        items={[{ ...lineA, allocated_quantity: "250.000", outstanding_quantity: "350.000" }]}
        status="PENDING"
        orderId={5}
        onItemsChange={vi.fn()}
      />,
    );

    await openPacking(user);

    expect(inputFor(/metres of cotton cambric to pack/i).value).toBe("250");
  });

  it("prefills an unpacked line with what the roll can cover", async () => {
    const user = userEvent.setup();
    section();

    await openPacking(user);
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

    await openPacking(user);
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

  it("stays in packing mode after a pack and marks the line as Packed", async () => {
    const user = userEvent.setup();
    packLine.mockResolvedValue(aResult);
    section();

    await openPacking(user);
    await waitFor(() =>
      expect(inputFor(/metres of cotton cambric to pack/i).value).toBe("600"),
    );
    await user.click(screen.getAllByRole("button", { name: /pack this line/i })[0]);

    // Still editable, so the admin can carry on with the other lines.
    expect(screen.getByRole("button", { name: /^done$/i })).toBeTruthy();
    expect(screen.getByText("Packed")).toBeTruthy();
    expect(inputFor(/metres of linen blend to pack/i)).toBeTruthy();
  });

  it("updates the packed line's own figures in place", async () => {
    const user = userEvent.setup();
    packLine.mockResolvedValue(aResult);
    section();

    await openPacking(user);
    await waitFor(() =>
      expect(inputFor(/metres of cotton cambric to pack/i).value).toBe("600"),
    );
    await user.click(screen.getAllByRole("button", { name: /pack this line/i })[0]);

    await waitFor(() => expect(screen.getByText("600 m packed")).toBeTruthy());
    // Never negative, even once a line is packed past what was ordered.
    expect(screen.getByText("0 m still owed")).toBeTruthy();
    expect(screen.getByText("1800 m on the roll")).toBeTruthy();
  });

  it("offers no packing button on a dispatched order", () => {
    render(
      <OrderItemsSection
        items={[lineA, lineB]}
        status="DISPATCHED"
        orderId={5}
        onItemsChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /update packing/i })).toBeNull();
  });

  it("offers no packing button to a non-admin", () => {
    roleRef.current = "AGENT";
    section();

    expect(screen.queryByRole("button", { name: /update packing/i })).toBeNull();
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

    await openPacking(user);
    const input = inputFor(/metres of cotton cambric to pack/i);
    await user.clear(input);
    await user.type(input, "55");
    await user.click(screen.getByRole("button", { name: /pack this line/i }));

    await waitFor(() => expect(packLine).toHaveBeenCalledWith(5, 7, "55"));

    // The line and the order header both report the real 55 m, not the 50 m
    // that were ordered.
    expect(screen.getByText("55 m packed")).toBeTruthy();
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

    await openPacking(user);
    const input = inputFor(/metres of cotton cambric to pack/i);
    await user.clear(input);
    await user.type(input, "55");
    await user.click(screen.getByRole("button", { name: /pack this line/i }));

    await waitFor(() => expect(screen.getByText("0 m still owed")).toBeTruthy());
    expect(screen.queryByText(/-5 m still owed/i)).toBeNull();
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

    await openPacking(user);
    const input = inputFor(/metres of cotton cambric to pack/i);
    await user.clear(input);
    await user.type(input, "55");
    await user.click(screen.getByRole("button", { name: /pack this line/i }));

    await waitFor(() => expect(screen.getByText("+5 m over ordered")).toBeTruthy());
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

    await openPacking(user);
    const input = inputFor(/metres of cotton cambric to pack/i);
    await user.clear(input);
    await user.type(input, "50");
    await user.click(screen.getByRole("button", { name: /pack this line/i }));

    await waitFor(() => expect(screen.getByText("50 m packed")).toBeTruthy());
    expect(screen.queryByText(/over ordered/i)).toBeNull();
  });

  it("pre-fills the box with the metres actually packed", async () => {
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

    await openPacking(user);
    const input = inputFor(/metres of cotton cambric to pack/i);
    await user.clear(input);
    await user.type(input, "55");
    await user.click(screen.getByRole("button", { name: /pack this line/i }));

    // Re-opening packing mode starts from the 55 m stored, not the 50 m ordered.
    await waitFor(() => expect(input.value).toBe("55"));
    await user.click(screen.getByRole("button", { name: /^done$/i }));
    await user.click(screen.getByRole("button", { name: /^update packing$/i }));

    expect(inputFor(/metres of cotton cambric to pack/i).value).toBe("55");
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

    await openPacking(user);
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

    await user.click(screen.getByRole("button", { name: /^update packing$/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /pack this line/i })).toBeTruthy(),
    );
    await user.click(screen.getByRole("button", { name: /pack this line/i }));

    await waitFor(() => expect(onItemsChange).toHaveBeenCalled());
  });
});
