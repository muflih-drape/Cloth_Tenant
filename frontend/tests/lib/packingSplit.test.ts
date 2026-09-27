import { describe, it, expect } from "vitest";
import {
  splitEqually,
  splitProblems,
  type SplittableLine,
} from "../../lib/utils/packingSplit";
import { roundMetres } from "../../types/item";

/** Metre strings on purpose: the API sends decimals, not numbers. */
function line(
  orderItem: number,
  outstanding: string,
  priorityRank: number | null = null,
): SplittableLine {
  return {
    order_item: orderItem,
    order: 100 + orderItem,
    customer: `Customer ${orderItem}`,
    outstanding_quantity: outstanding,
    priority_rank: priorityRank,
  };
}

const metresFor = (result: Record<number, string>) =>
  Object.fromEntries(
    Object.entries(result).map(([id, value]) => [Number(id), Number(value)]),
  );

describe("splitEqually", () => {
  it("gives everyone the same share when the roll divides cleanly", () => {
    const result = splitEqually([line(1, "10"), line(2, "10")], 10);

    expect(metresFor(result)).toEqual({ 1: 5, 2: 5 });
  });

  it("gives the remainder to the highest-priority customer", () => {
    // 10 m over three lines is 3.33 each, leaving 0.01 behind.
    const result = splitEqually(
      [line(1, "10", 3), line(2, "10", 1), line(3, "10", 2)],
      10,
    );

    expect(metresFor(result)).toEqual({ 1: 3.333, 2: 3.334, 3: 3.333 });
  });

  it("never gives a line more than it still needs", () => {
    const result = splitEqually([line(1, "1"), line(2, "20")], 10);

    // Line 1 caps at its 1 m outstanding; the rest goes to line 2.
    expect(metresFor(result)).toEqual({ 1: 1, 2: 9 });
  });

  it("leaves the roll alone when a single line cannot absorb it", () => {
    const result = splitEqually([line(1, "2")], 10);

    expect(metresFor(result)).toEqual({ 1: 2 });
  });

  it("spreads a short roll instead of letting the first line take it all", () => {
    const result = splitEqually([line(1, "10", 1), line(2, "10", 2)], 3);

    expect(metresFor(result)).toEqual({ 1: 1.5, 2: 1.5 });
  });

  it("returns nothing for an empty selection", () => {
    expect(splitEqually([], 10)).toEqual({});
  });

  it("keeps every figure within 3-decimal precision", () => {
    const result = splitEqually([line(1, "10"), line(2, "10"), line(3, "10")], 1);

    for (const value of Object.values(result)) {
      expect(value).toBe(String(roundMetres(Number(value))));
      expect(String(Number(value))).toBe(value);
    }
  });

  it("does not over-commit the roll when shares do not divide evenly", () => {
    const result = splitEqually(
      [line(1, "10"), line(2, "10"), line(3, "10")],
      10,
    );
    const total = Object.values(result).reduce((sum, v) => sum + Number(v), 0);

    expect(roundMetres(total)).toBe(10);
  });
});

describe("splitProblems", () => {
  it("passes a clean split", () => {
    const lines = [line(1, "10"), line(2, "10")];

    expect(splitProblems(lines, { 1: "4", 2: "6" }, 10)).toEqual([]);
  });

  it("complains when nothing is ticked", () => {
    expect(splitProblems([], {}, 10)).toEqual([
      "Tick at least one order to pack for.",
    ]);
  });

  it("names the order that has no metres", () => {
    expect(splitProblems([line(1, "10")], { 1: "" }, 10)).toEqual([
      "Customer 1 (order #101) has no metres entered.",
    ]);
  });

  it("stops a line being given more than it needs", () => {
    expect(splitProblems([line(1, "4")], { 1: "9" }, 10)).toEqual([
      "Customer 1 (order #101) only needs 4 m.",
    ]);
  });

  it("stops the round overdrawing the roll", () => {
    const lines = [line(1, "10"), line(2, "10")];

    expect(splitProblems(lines, { 1: "6", 2: "6" }, 10)).toEqual([
      "That is 12 m but only 10 m are on the roll.",
    ]);
  });

  it("does not flag a total that only looks over due to float drift", () => {
    // 0.1 + 0.2 is 0.30000000000000004 in floating point; the backend stores
    // 3 decimals, so this split is exactly within stock.
    expect(splitProblems([line(1, "1"), line(2, "1")], { 1: "0.1", 2: "0.2" }, "0.3")).toEqual(
      [],
    );
  });
});
