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
  /** How many real rolls in this bundle went to this line. */
  rolls: number;
  /** How many pieces altogether, including metres that were never on a roll. */
  pieces: number;
  /** The rolls themselves, for the "which roll" line under the name. */
  rollNumbers: string[];
}

/**
 * Groups a bundle's contents by the order line they were packed against.
 *
 * A bundle is not a list of lines: it is a list of *pieces* of cloth, and a piece
 * belongs to whatever line its colour matched. So the lines a bundle covered have to
 * be gathered back out of those pieces -- and when one line's metres were split over
 * two boxes, each box reports only the part it actually carried.
 *
 * A piece with no roll number was typed in by the packer rather than scanned off a
 * roll. It counts towards the line and towards the bundle, but it is not a roll and
 * is not given a roll number to print.
 *
 * Kept in first-seen order so the shares read in the order the pieces were packed,
 * and a bundle that packed nothing resolves to no shares at all.
 */
export function bundleLineShares(bundle: PackingBundle): BundleLineShare[] {
  const shares = new Map<number, BundleLineShare>();

  for (const piece of bundle.rolls) {
    const existing = shares.get(piece.item);
    const metres = toMeters(piece.metres);
    const value = Number(piece.value ?? 0);
    if (existing) {
      existing.metres += metres;
      existing.value += value;
      existing.pieces += 1;
      if (piece.roll_number) {
        existing.rolls += 1;
        existing.rollNumbers.push(piece.roll_number);
      }
      continue;
    }
    shares.set(piece.item, {
      itemId: piece.item,
      fabricName: piece.fabric_name || piece.fabric,
      colour: piece.variant_display_order || piece.colour,
      metres,
      value,
      pieces: 1,
      rolls: piece.roll_number ? 1 : 0,
      rollNumbers: piece.roll_number ? [piece.roll_number] : [],
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