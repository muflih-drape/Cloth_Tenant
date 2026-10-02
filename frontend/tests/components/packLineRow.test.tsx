import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import PackLineRow from "@/components/pages/admin/packing/PackLineRow";
import { packingApi } from "@/lib/api/order";
import type { OrderItem, PackLineResponse } from "@/types/order";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/api/order", () => ({
  packingApi: { packLine: vi.fn() },
}));

const packLine = vi.mocked(packingApi.packLine);

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
    variant_image: null,
    ordered_quantity: "1400.000",
    allocated_quantity: "600.000",
    outstanding_quantity: "800.000",
    line_total: "12600.00",
    allocation_count: 1,
    ...overrides,
  };
}

function packedResult(overrides: Partial<PackLineResponse> = {}): PackLineResponse {
  return {
    message: "Packed 600 m",
    round: 42,
    order: 5,
    order_status: "PACKED",
    item: line({
      allocated_quantity: "1200.000",
      outstanding_quantity: "200.000",
      allocation_count: 2,
    }),
    stock_meters: "1800.000",
    ...overrides,
  };
}

/** A settled line: the admin hands over more than it still owed. */
function overPackedResult(): PackLineResponse {
  return {
    message: "Packed 600 m",
    round: 43,
    order: 5,
    order_status: "PACKED",
    item: line({
      allocated_quantity: "1500.000",
      outstanding_quantity: "0.000",
      allocation_count: 2,
    }),
    stock_meters: "1800.000",
  };
}

const metresInput = () =>
  screen.getByLabelText(/metres of cotton cambric 140 gsm to pack/i) as HTMLInputElement;

const packButton = () => screen.getByRole("button", { name: /pack this line/i });

/** The page owns the figure, so the row is rendered as a controlled input. */
function row(props: Partial<React.ComponentProps<typeof PackLineRow>> = {}) {
  const { onPacked = vi.fn(), ...rest } = props;
  return render(
    <PackLineRow
      orderId={5}
      line={line()}
      stockMeters="2400.000"
      metres="600"
      onMetresChange={vi.fn()}
      justPacked={false}
      {...rest}
      onPacked={onPacked}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PackLineRow", () => {
  it("renders the controls inside the line card with no toggle of its own", () => {
    row();

    // No per-line disclosure any more: the page has one button for the order.
    expect(screen.queryByRole("button", { name: /update packing/i })).toBeNull();
    expect(packButton()).toBeTruthy();
    expect(metresInput()).toBeTruthy();
  });

  it("shows ordered, packed, still owed and the roll behind the line", () => {
    row();

    expect(screen.getByText("1400 m ordered")).toBeTruthy();
    expect(screen.getByText("600 m packed")).toBeTruthy();
    expect(screen.getByText("800 m still owed")).toBeTruthy();
    expect(screen.getByText("2400 m on the roll")).toBeTruthy();
  });

  it("never shows still owed as a negative on an over-packed line", () => {
    // A line packed past what was ordered comes back with a negative remainder
    // from an older API; it must read as settled, not as owing cloth back.
    row({
      line: line({
        allocated_quantity: "1500.000",
        outstanding_quantity: "-100.000",
      }),
    });

    expect(screen.getByText("0 m still owed")).toBeTruthy();
    expect(screen.queryByText(/-100 m still owed/)).toBeNull();
  });

  it("says so while the stock figure is still unknown", () => {
    row({ stockMeters: null });

    expect(screen.getByText("stock loading…")).toBeTruthy();
  });

  it("shows a Packed marker on a line it has just packed", () => {
    row({ justPacked: true });

    expect(screen.getByText("Packed")).toBeTruthy();
  });

  it("hands a typed-in figure back to the page rather than holding it", async () => {
    const user = userEvent.setup();
    const onMetresChange = vi.fn();
    row({ onMetresChange });

    await user.type(metresInput(), "5");

    expect(onMetresChange).toHaveBeenCalled();
  });

  it("packs the line with the figure it was given, for that line only", async () => {
    const user = userEvent.setup();
    const onPacked = vi.fn();
    packLine.mockResolvedValue(packedResult());
    row({ metres: "600", onPacked });

    await user.click(packButton());

    await waitFor(() => expect(packLine).toHaveBeenCalledWith(5, 7, "600"));
    expect(packLine).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onPacked).toHaveBeenCalledWith(packedResult()));

    expect(toast.success).toHaveBeenCalledWith("Packed 600 m", {
      description: "Cotton Cambric 140 GSM · 1800 m left on the roll",
      duration: 3000,
    });
  });

  it("accepts more metres than the line owes, because a roll is cut whole", async () => {
    const user = userEvent.setup();
    const onPacked = vi.fn();
    packLine.mockResolvedValue(overPackedResult());
    row({ metres: "900", onPacked });

    await user.click(packButton());

    // No complaint from the browser: stock is the only limit it knows about.
    await waitFor(() => expect(packLine).toHaveBeenCalledWith(5, 7, "900"));
    expect(screen.queryByRole("alert")).toBeNull();

    // And the line comes back settled at zero, never negative.
    const result = overPackedResult();
    await waitFor(() => expect(onPacked).toHaveBeenCalledWith(result));
    expect(result.item.outstanding_quantity).toBe("0.000");
  });

  it("refuses metres above the stock on hand, without calling the API", async () => {
    const user = userEvent.setup();
    row({ metres: "600", stockMeters: "500.000" });

    await user.click(packButton());

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "That is 600 m but only 500 m are on the roll.",
    );
    expect(packLine).not.toHaveBeenCalled();
  });

  it("refuses an empty figure, without calling the API", async () => {
    const user = userEvent.setup();
    row({ metres: "" });

    await user.click(packButton());

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Enter how many metres to pack for Cotton Cambric 140 GSM.",
    );
    expect(packLine).not.toHaveBeenCalled();
  });

  it("keeps the typed figure when a pack is refused by the server", async () => {
    const user = userEvent.setup();
    packLine.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: "That is 600 m but only 400 m of Cotton Cambric 140 GSM are in stock.",
        },
      },
    });
    row({ metres: "600" });

    await user.click(packButton());

    // The backend's own wording reaches the admin, not a generic failure.
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "That is 600 m but only 400 m of Cotton Cambric 140 GSM are in stock. (HTTP 400)",
        { duration: 3000 },
      ),
    );
    expect(metresInput().value).toBe("600");
  });

  it("reports a permission refusal from the server", async () => {
    const user = userEvent.setup();
    packLine.mockRejectedValue({
      response: { status: 403, data: { error: "Forbidden" } },
    });
    row();

    await user.click(packButton());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Forbidden (HTTP 403)", {
        duration: 3000,
      }),
    );
  });

  it("disables the controls while the pack is in flight", async () => {
    const user = userEvent.setup();
    let release: (value: PackLineResponse) => void = () => {};
    packLine.mockReturnValue(
      new Promise<PackLineResponse>((resolve) => {
        release = resolve;
      }),
    );
    row();

    await user.click(packButton());

    await waitFor(() =>
      expect(packButton()).toHaveProperty("disabled", true),
    );
    expect(metresInput().disabled).toBe(true);

    release(packedResult());
    await waitFor(() => expect(packLine).toHaveBeenCalledTimes(1));
  });
});
