import { describe, it, expect } from "vitest";

import {
  bundleCoverageMetres,
  bundleLineShares,
  metresPackedOutsideBundles,
  packedOutsideBundleLines,
} from "@/lib/utils/bundleLines";
import type {
  OrderItem,
  PackingBundle,
  PackingBundleRoll,
} from "@/types/order";

/**
 * Metres typed in by the packer rather than scanned off a roll. The server sends
 * these as a piece with no roll behind it, and the panel and the slip both have to
 * cope without inventing a roll number for it.
 */
function handPiece(overrides: Partial<PackingBundleRoll> = {}): PackingBundleRoll {
  return {
    id: 21,
    allocation_id: 8,
    roll: null,
    roll_number: "",
    colour: "Natural",
    fabric: "Cotton Cambric 140 GSM",
    metres: "250.000",
    item: 7,
    fabric_name: "Cotton Cambric 140 GSM",
    variant_display_order: "Natural",
    rate_per_meter: "9.00",
    value: "2250.00",
    round: 42,
    scanned_at: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

function scannedRoll(overrides: Partial<PackingBundleRoll> = {}): PackingBundleRoll {
  return {
    id: 11,
    allocation_id: 4,
    roll: 3,
    roll_number: "NAT-0001",
    colour: "Natural",
    fabric: "Cotton Cambric 140 GSM",
    metres: "600.000",
    item: 7,
    fabric_name: "Cotton Cambric 140 GSM",
    variant_display_order: "Natural",
    rate_per_meter: "9.00",
    value: "5400.00",
    round: 42,
    scanned_at: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

function bundle(overrides: Partial<PackingBundle> = {}): PackingBundle {
  const rolls = overrides.rolls ?? [];
  return {
    id: 1,
    number: 1,
    code: "Order #5 -- Bundle 1",
    status: "SEALED",
    created_at: "2026-02-01T09:00:00Z",
    sealed_at: "2026-02-01T11:00:00Z",
    dispatched_at: null,
    is_dispatched: false,
    created_by: "admin1",
    order: 5,
    order_number: 5,
    customer: "Riya Textiles",
    customer_address: "14 Mill Lane",
    rolls,
    roll_count: rolls.filter((r) => Boolean(r.roll_number)).length,
    piece_count: rolls.length,
    is_roll_based: rolls.some((r) => Boolean(r.roll_number)),
    total_metres: rolls.reduce((s, r) => s + Number(r.metres), 0).toFixed(3),
    total_value: rolls.reduce((s, r) => s + Number(r.value), 0).toFixed(2),
    ...overrides,
  };
}

function line(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
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
    ordered_quantity: "1400.000",
    allocated_quantity: "0.000",
    outstanding_quantity: "1400.000",
    line_total: "12600.00",
    allocation_count: 0,
    is_roll_tracked: false,
    ...overrides,
  } as OrderItem;
}

describe("bundleLineShares with metres packed by hand", () => {
  it("counts a hand-packed piece towards the line without calling it a roll", () => {
    const [share] = bundleLineShares(bundle({ rolls: [handPiece()] }));

    expect(share.metres).toBe(250);
    expect(share.value).toBe(2250);
    expect(share.pieces).toBe(1);
    // It was not off a roll, so there is no roll to name and none to claim.
    expect(share.rolls).toBe(0);
    expect(share.rollNumbers).toEqual([]);
  });

  it("adds a hand-packed piece to a line that already has a roll", () => {
    const [share] = bundleLineShares(
      bundle({ rolls: [scannedRoll(), handPiece()] }),
    );

    expect(share.metres).toBe(850);
    expect(share.pieces).toBe(2);
    expect(share.rolls).toBe(1);
    expect(share.rollNumbers).toEqual(["NAT-0001"]);
  });

  it("keeps a line that only ever had rolls reading the same as before", () => {
    const [share] = bundleLineShares(
      bundle({
        rolls: [
          scannedRoll(),
          scannedRoll({ id: 12, roll: 4, roll_number: "NAT-0002" }),
        ],
      }),
    );

    expect(share.rolls).toBe(2);
    expect(share.rollNumbers).toEqual(["NAT-0001", "NAT-0002"]);
  });

  it("keeps separate lines apart even when both came off the same bundle", () => {
    const shares = bundleLineShares(
      bundle({
        rolls: [
          handPiece(),
          handPiece({ id: 22, allocation_id: 9, item: 8, metres: "100.000" }),
        ],
      }),
    );

    expect(shares).toHaveLength(2);
    expect(shares.map((s) => s.itemId)).toEqual([7, 8]);
    expect(shares.every((s) => s.rolls === 0)).toBe(true);
  });
});

describe("bundle coverage when metres are packed by hand", () => {
  it("credits a hand-packed bundle against its line", () => {
    const coverage = bundleCoverageMetres([bundle({ rolls: [handPiece()] })]);

    expect(coverage[7]).toBe(250);
    expect(metresPackedOutsideBundles(line({ allocated_quantity: "250.000" }), coverage)).toBe(0);
  });

  it("still counts a dispatched bundle, because the cloth did go out", () => {
    const coverage = bundleCoverageMetres([
      bundle({ rolls: [handPiece()], dispatched_at: "2026-02-03T08:00:00Z", is_dispatched: true }),
    ]);

    expect(coverage[7]).toBe(250);
  });

  it("leaves a cancelled bundle out, as before", () => {
    const coverage = bundleCoverageMetres([
      bundle({ status: "CANCELLED", rolls: [handPiece()] }),
    ]);

    expect(coverage[7]).toBeUndefined();
  });

  it("reports only the genuinely un-bundled metres as packed by hand", () => {
    const coverage = bundleCoverageMetres([bundle({ rolls: [handPiece()] })]);
    // 400 m allocated, of which 250 m is in a bundle: 150 m is outside one.
    const outstanding = line({
      allocated_quantity: "400.000",
      outstanding_quantity: "0.000",
    });

    expect(metresPackedOutsideBundles(outstanding, coverage)).toBe(150);
    expect(
      packedOutsideBundleLines([outstanding], coverage).map((l) => l.id),
    ).toEqual([7]);
  });
});