import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DeleteWithTransferDialog from "@/components/ui/deleteWithTransferDialog";

vi.mock("@/components/ui/custom/stockFlowSelect", () => ({
  default: ({
    value,
    onChange,
    options,
    placeholder,
  }: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
    placeholder?: string;
  }) => (
    <select
      aria-label={placeholder || "select"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("@/components/ui/Loading", () => ({
  PageLoading: () => null,
}));

const onDelete = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

function dialogProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    entityType: "agent" as const,
    entityId: 9,
    entityName: "Agent One",
    onFetchDeleteInfo: vi.fn().mockResolvedValue({
      customers_count: 3,
      orders_count: 4,
      transferable_agents: [{ id: 2, name: "Agent Two" }],
    }),
    onDelete,
    ...overrides,
  };
}

const pinInputs = () =>
  Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  );

const typeDigits = async (user: ReturnType<typeof userEvent.setup>) => {
  const boxes = pinInputs();
  for (let i = 0; i < 6; i += 1) {
    await user.type(boxes[i], String(i + 1));
  }
};

describe("DeleteWithTransferDialog PIN flow", () => {
  it("shows the 6-digit PIN input for both the transfer and deactivate options", async () => {
    render(<DeleteWithTransferDialog {...dialogProps()} />);

    await screen.findByText(/enter your 6-digit pin to confirm/i);
    expect(pinInputs()).toHaveLength(6);

    await userEvent.click(
      screen.getByLabelText(/transfer customers to another agent/i),
    );

    expect(screen.getByText(/enter your 6-digit pin to confirm/i)).toBeTruthy();
    expect(pinInputs()).toHaveLength(6);
  });

  it("blocks submit and shows the incomplete-PIN message when under 6 digits", async () => {
    const user = userEvent.setup();
    onDelete.mockResolvedValue(undefined);
    render(<DeleteWithTransferDialog {...dialogProps()} />);

    await screen.findByText(/enter your 6-digit pin to confirm/i);
    await user.type(pinInputs()[0], "1");

    await user.click(screen.getByRole("button", { name: /deactivate/i }));

    expect(screen.getByText("Please enter all 6 digits.")).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("clears the incomplete-PIN message as soon as a digit is entered", async () => {
    const user = userEvent.setup();
    render(<DeleteWithTransferDialog {...dialogProps()} />);

    await screen.findByText(/enter your 6-digit pin to confirm/i);
    await user.click(screen.getByRole("button", { name: /deactivate/i }));
    expect(screen.getByText("Please enter all 6 digits.")).toBeTruthy();

    await user.type(pinInputs()[0], "1");

    expect(screen.queryByText("Please enter all 6 digits.")).toBeNull();
  });

  it("sends a complete PIN with the deactivate action", async () => {
    const user = userEvent.setup();
    onDelete.mockResolvedValue(undefined);
    render(<DeleteWithTransferDialog {...dialogProps()} />);

    await screen.findByText(/enter your 6-digit pin to confirm/i);
    await typeDigits(user);
    await user.click(screen.getByRole("button", { name: /deactivate/i }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    expect(onDelete).toHaveBeenCalledWith(9, {
      pin: "123456",
      action: "deactivate",
      transfer_to_id: undefined,
    });
  });

  it("sends the PIN and the selected target for the transfer option", async () => {
    const user = userEvent.setup();
    onDelete.mockResolvedValue(undefined);
    render(<DeleteWithTransferDialog {...dialogProps()} />);

    await screen.findByText(/enter your 6-digit pin to confirm/i);
    await user.click(
      screen.getByLabelText(/transfer customers to another agent/i),
    );

    const target = await screen.findByRole("combobox");
    expect(target).toBeTruthy();
    await user.selectOptions(target, "2");

    await typeDigits(user);
    await user.click(screen.getByRole("button", { name: /transfer & delete/i }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    expect(onDelete).toHaveBeenCalledWith(9, {
      pin: "123456",
      action: "transfer",
      transfer_to_id: 2,
    });
  });

  it("surfaces the backend's own error message and clears the PIN", async () => {
    const user = userEvent.setup();
    onDelete.mockRejectedValue({
      response: { data: { error: "Incorrect PIN." } },
    });
    render(<DeleteWithTransferDialog {...dialogProps()} />);

    await screen.findByText(/enter your 6-digit pin to confirm/i);
    await typeDigits(user);
    await user.click(screen.getByRole("button", { name: /deactivate/i }));

    await screen.findByText("Incorrect PIN.");
    expect(pinInputs().every((box) => (box as HTMLInputElement).value === "")).toBe(
      true,
    );
  });

  it("resets the PIN when the dialog closes and reopens", async () => {
    const user = userEvent.setup();
    const props = dialogProps();
    const { rerender } = render(<DeleteWithTransferDialog {...props} />);

    await screen.findByText(/enter your 6-digit pin to confirm/i);
    await typeDigits(user);
    expect((pinInputs()[0] as HTMLInputElement).value).toBe("1");

    rerender(<DeleteWithTransferDialog {...props} open={false} />);
    rerender(<DeleteWithTransferDialog {...props} open={true} />);

    await screen.findByText(/enter your 6-digit pin to confirm/i);
    expect(pinInputs().every((box) => (box as HTMLInputElement).value === "")).toBe(
      true,
    );
  });
});