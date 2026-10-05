import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReceiveRollsDialog from "@/components/items/receiveRollsDialog";

/** The metres box of one numbered roll row. */
const metres = (n: number) =>
  screen.getByLabelText(`Roll ${n} metres`) as HTMLInputElement;

/** The "how many rolls of this length" box of one numbered roll row. */
const count = (n: number) =>
  screen.getByLabelText(`Roll ${n} count`) as HTMLInputElement;

const addRow = () =>
  userEvent.click(screen.getByRole("button", { name: /add another length/i }));

const receive = () =>
  userEvent.click(screen.getByRole("button", { name: /^Receive$/i }));

describe("ReceiveRollsDialog", () => {
  it("offers a length and a count per row, and no note box", async () => {
    render(
      <ReceiveRollsDialog open onClose={vi.fn()} onConfirm={vi.fn()} />,
    );

    expect(screen.getByLabelText("Roll 1 metres")).toBeTruthy();
    expect(screen.getByLabelText("Roll 1 count")).toBeTruthy();
    expect(screen.queryByLabelText("Roll 1 note")).toBeNull();
    expect(screen.queryByPlaceholderText(/note/i)).toBeNull();
    // A row is one roll until the admin says otherwise.
    expect(count(1).value).toBe("1");

    await addRow();
    expect(screen.getByLabelText("Roll 2 metres")).toBeTruthy();
    expect(screen.getByLabelText("Roll 2 count")).toBeTruthy();
    expect(screen.queryByLabelText("Roll 2 note")).toBeNull();
  });

  it("shows the running total even for a single roll", async () => {
    render(
      <ReceiveRollsDialog open onClose={vi.fn()} onConfirm={vi.fn()} />,
    );

    await userEvent.type(metres(1), "250.5");
    expect(screen.getByText(/^1 roll$/)).toBeTruthy();
    expect(screen.getByText(/250\.5 m total/i)).toBeTruthy();
  });

  it("counts the rolls, not the rows", async () => {
    render(
      <ReceiveRollsDialog open onClose={vi.fn()} onConfirm={vi.fn()} />,
    );

    await userEvent.type(metres(1), "100");
    await userEvent.clear(count(1));
    await userEvent.type(count(1), "5");

    // One row on screen, five rolls on the books.
    expect(screen.queryByLabelText("Roll 2 metres")).toBeNull();
    expect(screen.getByText(/^5 rolls$/)).toBeTruthy();
    expect(screen.getByText(/500 m total/i)).toBeTruthy();
    expect(screen.getByText(/= 5 rolls/i)).toBeTruthy();
  });

  it("sends one entry per roll for a '100 m times 5' row", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ReceiveRollsDialog open onClose={vi.fn()} onConfirm={onConfirm} />,
    );

    await userEvent.type(metres(1), "100");
    await userEvent.clear(count(1));
    await userEvent.type(count(1), "5");
    await receive();

    expect(onConfirm).toHaveBeenCalledWith([
      { meters: "100" },
      { meters: "100" },
      { meters: "100" },
      { meters: "100" },
      { meters: "100" },
    ]);
  });

  it("expands mixed rows and sums them", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ReceiveRollsDialog open onClose={vi.fn()} onConfirm={onConfirm} />,
    );

    await userEvent.type(metres(1), "100");
    await userEvent.clear(count(1));
    await userEvent.type(count(1), "5");
    await addRow();
    await userEvent.type(metres(2), "250");

    expect(screen.getByText(/^6 rolls$/)).toBeTruthy();
    expect(screen.getByText(/750 m total/i)).toBeTruthy();

    await receive();
    const sent = onConfirm.mock.calls[0][0];
    expect(sent).toHaveLength(6);
    expect(sent.slice(0, 5)).toEqual(Array(5).fill({ meters: "100" }));
    expect(sent[5]).toEqual({ meters: "250" });
  });

  it("treats a blank count as a single roll", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ReceiveRollsDialog open onClose={vi.fn()} onConfirm={onConfirm} />,
    );

    await userEvent.type(metres(1), "100");
    await userEvent.clear(count(1));
    expect(screen.getByText(/^1 roll$/)).toBeTruthy();

    await receive();
    expect(onConfirm).toHaveBeenCalledWith([{ meters: "100" }]);
  });

  it("refuses a count that is not a whole number of rolls", async () => {
    const onConfirm = vi.fn();
    render(
      <ReceiveRollsDialog open onClose={vi.fn()} onConfirm={onConfirm} />,
    );

    await userEvent.type(metres(1), "100");
    await userEvent.clear(count(1));
    await userEvent.type(count(1), "1.5");
    await receive();
    expect(
      await screen.findByText(
        /Roll 1: how many rolls must be a whole number/i,
      ),
    ).toBeTruthy();

    await userEvent.clear(count(1));
    await userEvent.type(count(1), "0");
    await receive();
    expect(
      await screen.findByText(/Roll 1: enter at least one roll/i),
    ).toBeTruthy();

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("refuses more rolls than one delivery can hold", async () => {
    const onConfirm = vi.fn();
    render(
      <ReceiveRollsDialog open onClose={vi.fn()} onConfirm={onConfirm} />,
    );

    await userEvent.type(metres(1), "100");
    await userEvent.clear(count(1));
    await userEvent.type(count(1), "600");
    await receive();

    expect(
      await screen.findByText(/more rolls than one delivery can hold/i),
    ).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("starts from the rolls it is given, one row each", async () => {
    // Without this a colour that already had its rolls typed in reopened the
    // dialog blank, and correcting one row meant retyping the rest.
    render(
      <ReceiveRollsDialog
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        initialRolls={[{ meters: "500" }, { meters: "450" }]}
      />,
    );

    expect(metres(1).value).toBe("500");
    expect(metres(2).value).toBe("450");
    expect(count(1).value).toBe("1");
    expect(count(2).value).toBe("1");
    expect(screen.getByText(/^2 rolls$/)).toBeTruthy();
    expect(screen.getByText(/950 m total/i)).toBeTruthy();
  });

  it("reseeds when it is reopened on a different delivery", async () => {
    // The colour screen opens this dialog once to add rolls and again to correct
    // them, so the second opening has to show what is already there.
    const onClose = vi.fn();
    const { rerender } = render(
      <ReceiveRollsDialog
        open
        onClose={onClose}
        onConfirm={vi.fn()}
        initialRolls={[{ meters: "500" }]}
      />,
    );

    await receive();
    expect(onClose).toHaveBeenCalled();

    rerender(
      <ReceiveRollsDialog
        open={false}
        onClose={onClose}
        onConfirm={vi.fn()}
        initialRolls={[{ meters: "500" }]}
      />,
    );
    rerender(
      <ReceiveRollsDialog
        open
        onClose={onClose}
        onConfirm={vi.fn()}
        initialRolls={[{ meters: "120" }, { meters: "80" }]}
      />,
    );

    expect(metres(1).value).toBe("120");
    expect(metres(2).value).toBe("80");
  });

  it("keeps what is being typed when the page rebuilds the rolls prop", async () => {
    // The colour screen hands down a fresh array as the admin works. Reseeding on
    // that would wipe the row being typed on every keystroke.
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <ReceiveRollsDialog
        open
        onClose={vi.fn()}
        onConfirm={onConfirm}
        initialRolls={[{ meters: "500" }]}
      />,
    );

    await userEvent.clear(metres(1));
    await userEvent.type(metres(1), "250");
    rerender(
      <ReceiveRollsDialog
        open
        onClose={vi.fn()}
        onConfirm={onConfirm}
        initialRolls={[{ meters: "500" }]}
      />,
    );

    expect(metres(1).value).toBe("250");

    await receive();
    expect(onConfirm).toHaveBeenCalledWith([{ meters: "250" }]);
  });

  it("confirms with the lengths alone", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ReceiveRollsDialog
        open
        onClose={vi.fn()}
        onConfirm={onConfirm}
        initialRolls={[{ meters: "30" }]}
      />,
    );

    await addRow();
    await userEvent.type(metres(2), "50");
    await receive();

    expect(onConfirm).toHaveBeenCalledWith([{ meters: "30" }, { meters: "50" }]);
  });

  it("removes a row but never the last one", async () => {
    render(
      <ReceiveRollsDialog
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        initialRolls={[{ meters: "30" }, { meters: "50" }]}
      />,
    );

    expect(
      screen.getByRole("button", { name: /remove roll 1/i }),
    ).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /remove roll 1/i }));
    expect(metres(1).value).toBe("50");
    // One row is the floor: a delivery is at least one roll.
    expect(
      (screen.getByRole("button", { name: /remove roll 1/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("refuses a blank or non-positive figure before calling the server", async () => {
    const onConfirm = vi.fn();
    render(
      <ReceiveRollsDialog open onClose={vi.fn()} onConfirm={onConfirm} />,
    );

    await receive();
    expect(
      await screen.findByText(/Roll 1: enter how many metres it holds/i),
    ).toBeTruthy();

    await userEvent.type(metres(1), "-4");
    await receive();
    expect(
      await screen.findByText(/Roll 1: metres must be greater than zero/i),
    ).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});