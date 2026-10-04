import type { OrderItem, PackingBundle } from "@/types/order";
import { toMeters } from "@/types/item";

/**
 * One order line's share of a single bundle.
 *
 * A bundle is not a list of lines: it is a list of *rolls*, and a roll belongs to
 * whatever line its colour matched. So the lines a bundle covered have to be
 * gathered back out of those rolls -- and when one line's metres were split over
 * two boxes, each box reports only the part it actually carried.
 */
export interface BundleLineShare {
  /** The order line these metres were packed against. */
  itemId: number;
  fabricName: string;
  colour: string;
  /** Metres this bundle contributed to this line. */
  metres: number;
  /** What this bundle's contribution to this line came to. */
  value: number;
  /** How many rolls in this bundle went to this line. */
  rolls: number;
  /** The rolls themselves, for the "which roll" line under the name. */
  rollNumbers: string[];
}

/**
 * Groups a bundle's rolls by the order line they were packed against.
 *
 * Kept in first-seen order so the shares read in the order the rolls were
 * scanned, and a bundle that packed nothing resolves to no shares at all.
 */
export function bundleLineShares(bundle: PackingBundle): BundleLineShare[] {
  const shares = new Map<number, BundleLineShare>();

  for (const roll of bundle.rolls) {
    const existing = shares.get(roll.item);
    const metres = toMeters(roll.metres);
    const value = Number(roll.value ?? 0);
    if (existing) {
      existing.metres += metres;
      existing.value += value;
      existing.rolls += 1;
      existing.rollNumbers.push(roll.roll_number);
      continue;
    }
    shares.set(roll.item, {
      itemId: roll.item,
      fabricName: roll.fabric_name || roll.fabric,
      colour: roll.variant_display_order || roll.colour,
      metres,
      value,
      rolls: 1,
      rollNumbers: [roll.roll_number],
    });
  }

  return [...shares.values()];
}

/**
 * Metres of each order line that have gone into a bundle, keyed by line id.
 *
 * Cancelled bundles are left out: cancelling puts every roll back on its roll and
 * takes the metres off the order, so counting them would credit a line with cloth
 * it no longer has.
 */
export function bundleCoverageMetres(
  bundles: PackingBundle[],
): Record<number, number> {
  const coverage: Record<number, number> = {};
  for (const bundle of bundles) {
    if (bundle.status === "CANCELLED") continue;
    for (const share of bundleLineShares(bundle)) {
      coverage[share.itemId] = (coverage[share.itemId] ?? 0) + share.metres;
    }
  }
  return coverage;
}

/** Metres of this line that were packed by hand rather than scanned into a bundle. */
export function metresPackedOutsideBundles(
  line: OrderItem,
  coverage: Record<number, number>,
): number {
  const outside = toMeters(line.allocated_quantity) - (coverage[line.id] ?? 0);
  return outside > 0 ? outside : 0;
}

/**
 * Lines that packing has finished but that no bundle is showing.
 *
 * Cloth can be packed by typing a figure as well as by scanning a roll, and that
 * path writes no bundle at all. Hiding those lines from the main list without
 * saying where they went would lose them from the page, so they are collected here
 * to be shown under the bundles in their own right.
 */
export function packedOutsideBundleLines(
  lines: OrderItem[],
  coverage: Record<number, number>,
): OrderItem[] {
  return lines.filter(
    (line) =>
      toMeters(line.allocated_quantity) > 0 &&
      metresPackedOutsideBundles(line, coverage) > 0,
  );
}