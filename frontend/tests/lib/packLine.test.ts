import { describe, it, expect } from "vitest";
import {
  MIN_PACK_METERS,
  isPackable,
  packLineProblems,
  prefillPackMetres,
} from "../../lib/utils/packLine";
import { roundMetres } from "../../types/item";

/** Metre strings on purpose: the API sends decimals, not numbers. */
describe("prefillPackMetres", () => {
  it("offers everything the line still owes when the roll can cover it", () => {
    expect(prefillPackMetres("800.000", "2400.000")).toBe("800");
  });

  it("offers only what is left on the roll when that is less", () => {
    expect(prefillPackMetres("1400.000", "600.000")).toBe("600");
  });

  it("offers nothing when the line is already fully packed", () => {
    expect(prefillPackMetres("0.000", "2400.000")).toBe("0");
  });

  it("offers nothing when the roll is empty", () => {
    expect(prefillPackMetres("1400.000", "0.000")).toBe("0");
  });

  it("never suggests a negative figure for a negative stock reading", () => {
    expect(prefillPackMetres("1400.000", "-5.000")).toBe("0");
  });

  it("quantises to the three decimals the backend stores", () => {
    // 0.1 + 0.2 in floating point drifts; the suggestion must not.
    expect(prefillPackMetres("0.300", "1.000")).toBe(
      String(roundMetres(0.1 + 0.2)),
    );
  });

  it("keeps a millimetre-scale line intact", () => {
    expect(prefillPackMetres("0.001", "10.000")).toBe("0.001");
  });
});

describe("isPackable", () => {
  it("is true while the line owes something and the roll has cloth", () => {
    expect(isPackable("800.000", "2400.000")).toBe(true);
  });

  it("is false for a fully packed line", () => {
    expect(isPackable("0.000", "2400.000")).toBe(false);
  });

  it("is false when nothing is on the roll", () => {
    expect(isPackable("800.000", "0.000")).toBe(false);
  });
});

describe("packLineProblems", () => {
  const ctx = {
    stockMeters: "2400.000",
    label: "Cotton Cambric 140 GSM",
  };

  it("accepts a figure that fits the roll", () => {
    expect(packLineProblems({ ...ctx, metres: "600" })).toEqual([]);
    expect(packLineProblems({ ...ctx, metres: "2400" })).toEqual([]);
  });

  it("accepts less than the line still owes", () => {
    // A partial pack is legitimate: the remainder stays owed.
    expect(packLineProblems({ ...ctx, metres: "1" })).toEqual([]);
  });

  it("accepts more than the line owes, because a roll is cut whole", () => {
    // The only hard limit is the cloth physically on the roll, so 1200 m is a
    // valid pack even though the line only has 800 m left owing. Rounding a line
    // up is a decision, not a mistake to be caught in the browser.
    expect(packLineProblems({ ...ctx, metres: "1200" })).toEqual([]);
  });

  it("refuses more than the roll has, however much the line wanted", () => {
    const issues = packLineProblems({
      ...ctx,
      metres: "1500",
      stockMeters: "1000.000",
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("only 1000 m are on the roll");
  });

  it("refuses an empty or negative figure", () => {
    for (const metres of ["", "0", "-5", "0.0004"]) {
      expect(packLineProblems({ ...ctx, metres })).toHaveLength(1);
    }
  });

  it("allows a figure of exactly one gram", () => {
    expect(packLineProblems({ ...ctx, metres: String(MIN_PACK_METERS) })).toEqual(
      [],
    );
  });

  it("treats rubbish as zero rather than letting it through", () => {
    expect(packLineProblems({ ...ctx, metres: "12.5abc" })).toHaveLength(1);
  });

  it("names the line in its messages", () => {
    const issues = packLineProblems({ ...ctx, metres: "-1" });
    expect(issues[0]).toContain("Cotton Cambric 140 GSM");
  });

  it("compares at the backend's precision, so a rounding artefact is not a fault", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in floating point, which must be accepted
    // rather than tripping the three-decimal comparison against the roll.
    expect(packLineProblems({ ...ctx, metres: "0.300" })).toEqual([]);
  });
});
