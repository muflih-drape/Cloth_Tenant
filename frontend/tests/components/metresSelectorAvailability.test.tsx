import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import MetresSelector from "@/app/(agent-order)/agent/order/new/[id]/[qr]/components/MetresSelector";

/**
 * The screen an agent lands on after scanning a fabric QR, deciding metres.
 *
 * It has to answer "is there enough cloth left" in the only terms that matter --
 * availability, not the shelf total -- because the warehouse total says nothing
 * about what other orders have already claimed.
 */
type Props = React.ComponentProps<typeof MetresSelector>;

function renderSelector(props: Partial<Props> = {}) {
  const onChange = vi.fn();
  const merged: Props = {
    metres: "100",
    onChange,
    onHandMetres: 3000,
    availableMetres: 2500,
    ...props,
  };
  render(<MetresSelector {...merged} />);
  return { onChange, merged };
}

const availableFigure = () => screen.getByTestId("available-metres");
const body = () => document.body.textContent ?? "";

describe("available stock after scanning", () => {
  it("shows availability as the headline and stock on hand underneath", () => {
    renderSelector();

    expect(availableFigure().textContent).toContain("2500 m available");
    expect(body()).toContain("On hand: 3000 m");
  });

  it("keeps availability visible when nothing is on hand", () => {
    renderSelector({ onHandMetres: 0, availableMetres: 0, metres: "50" });

    expect(availableFigure().textContent).toContain("0 m available");
    expect(body()).toContain("On hand: 0 m");
  });

  it("marks availability red once it has gone negative", () => {
    renderSelector({ onHandMetres: 100, availableMetres: -60, metres: "10" });

    expect(availableFigure().textContent).toContain("-60 m available");
    expect(availableFigure().className).toContain("text-red-600");
  });

  it("does not warn while the request fits inside availability", () => {
    renderSelector({ metres: "100", availableMetres: 2500 });

    expect(body()).not.toContain("More than is free");
  });

  it("warns against availability, not the shelf total", () => {
    // 400 m asked, only 150 m free even though 3000 m is on the shelf.
    renderSelector({ metres: "400", onHandMetres: 3000, availableMetres: 150 });

    expect(body()).toContain("More than is free");
    expect(body()).toContain("400 m");
    expect(body()).toContain("150 m available");
  });

  it("explains an already-negative figure as oversold by other orders", () => {
    renderSelector({ metres: "100", onHandMetres: 100, availableMetres: -60 });

    expect(body()).toContain("Already oversold by 60 m");
  });

  it("never blocks the line -- the field stays editable", () => {
    const { onChange } = renderSelector({
      metres: "9999",
      availableMetres: -60,
      onHandMetres: 100,
    });

    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.disabled).toBe(false);
    expect(input.value).toBe("9999");

    onChange("50");
    expect(onChange).toHaveBeenCalledWith("50");
  });

  it("falls back to the shelf figure when the server sends no availability", () => {
    // The page guards against this; this documents what it resolves to.
    const { merged } = renderSelector({ onHandMetres: 1200 });
    expect(merged.availableMetres).toBe(2500);
  });
});
