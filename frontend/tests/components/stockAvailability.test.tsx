import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StockBadge from "@/components/items/StockBadge";
import StockMetresRow from "@/components/items/StockMetresRow";

/**
 * A colour's metres, shown the way an admin needs to read them.
 *
 * The headline is what is still orderable, because that is the figure that drops
 * the moment an order is placed and the one being judged. The warehouse total
 * stays underneath so the real cloth is never out of sight, and an oversold
 * colour is styled as an error rather than quietly showing a bare minus.
 */
describe("stock figures", () => {
  describe("StockBadge (Inventory list)", () => {
    it("leads with what is available and keeps the physical total below it", () => {
      render(<StockBadge total={100} available={40} unit="m" />);

      expect(screen.getByText(/^40 m$/)).toBeTruthy();
      expect(screen.getByText("available")).toBeTruthy();
      expect(screen.getByText(/On hand: 100 m/)).toBeTruthy();
    });

    it("marks an oversold colour as an error", () => {
      const { container } = render(
        <StockBadge total={100} available={-60} unit="m" />,
      );

      expect(screen.getByText(/^-60 m$/)).toBeTruthy();
      const figure = screen.getByText(/^-60 m$/);
      expect(figure.className).toContain("text-red-600");
      expect(container.textContent).toContain("On hand: 100 m");
    });

    it("falls back to the physical figure when the server sends no availability", () => {
      render(<StockBadge total={100} unit="m" />);

      expect(screen.getByText(/^100 m$/)).toBeTruthy();
      expect(screen.getByText(/On hand: 100 m/)).toBeTruthy();
    });

    it("treats exactly zero as empty rather than low", () => {
      render(<StockBadge total={100} available={0} unit="m" />);

      expect(screen.getByText(/^0 m$/).className).toContain("text-red-500");
    });
  });

  describe("StockMetresRow (expanded variant card)", () => {
    it("leads with availability and shows the warehouse total underneath", () => {
      render(<StockMetresRow stockMeters="100.000" availableMeters="40.000" />);

      expect(screen.getByText("Available")).toBeTruthy();
      expect(screen.getByText("40 m")).toBeTruthy();
      expect(screen.getByText("On hand: 100 m")).toBeTruthy();
    });

    it("marks an oversold colour as an error", () => {
      render(<StockMetresRow stockMeters="100.000" availableMeters="-60.000" />);

      expect(screen.getByText("-60 m").className).toContain("text-red-600");
    });

    it("falls back to the physical figure when the server sends no availability", () => {
      render(<StockMetresRow stockMeters="100.000" />);

      expect(screen.getByText("100 m")).toBeTruthy();
    });

    it("keeps showing the physical figure while the colour is out of stock", () => {
      render(
        <StockMetresRow
          stockMeters="0.000"
          availableMeters="0.000"
          isDisabled
        />,
      );

      expect(screen.getByText("On hand: 0 m")).toBeTruthy();
    });
  });
});