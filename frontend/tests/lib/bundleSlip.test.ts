import { describe, it, expect } from "vitest";

import { bundleSlipFilename, parseRollScan } from "@/lib/utils/bundleSlip";

describe("parseRollScan", () => {
  it("reads the roll's own number off its label", () => {
    expect(parseRollScan("3")).toBe(3);
    expect(parseRollScan("  412 ")).toBe(412);
  });

  it("rejects anything that is not a plain roll number", () => {
    // A fabric QR, say: passing it on would fail later as "no such roll".
    expect(parseRollScan("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBeNull();
    expect(parseRollScan("")).toBeNull();
    expect(parseRollScan("roll 3")).toBeNull();
    expect(parseRollScan("3.5")).toBeNull();
    expect(parseRollScan("0")).toBeNull();
    expect(parseRollScan("-7")).toBeNull();
  });
});

describe("bundleSlipFilename", () => {
  it("turns a bundle code into a filename a download can carry", () => {
    expect(bundleSlipFilename("Order #5 -- Bundle 1")).toBe(
      "Order-5-Bundle-1.pdf",
    );
  });

  it("keeps the file extension off the code's own punctuation", () => {
    expect(bundleSlipFilename("Order #5 -- Bundle 12")).toMatch(/\.pdf$/);
    expect(bundleSlipFilename("Order #5 -- Bundle 12")).not.toMatch(/--/);
  });
});