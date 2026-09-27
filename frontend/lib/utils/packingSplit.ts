import { formatMeters, roundMetres, toMeters } from "@/types/item";

/**
 * One row the packing board can hand metres to. Deliberately narrower than
 * PackingQueueLine: the split only needs the line's identity, what it still
 * needs, and the customer's priority rank.
 */
export interface SplittableLine {
  order_item: number;
  order: number;
  customer: string;
  outstanding_quantity: string;
  priority_rank: number | null;
}

/** What each selected line should be given, keyed by order line id. */
export type SplitResult = Record<number, string>;

/**
 * Prefill suggestion for the packing board: the even-share rule the board used
 * to apply on its own, now offered as a starting point the admin can edit.
 *
 * Everyone gets the same slice of the roll -- never more than they still need --
 * and whatever is left over goes to the highest-priority customer (the biggest
 * buyer) who can still absorb it. Every figure is quantised to 3 decimals, the
 * precision the backend stores metres at, so the suggestion never disagrees with
 * the server by a rounding error.
 *
 * This only ever produces a suggestion: nothing here touches stock.
 */
export function splitEqually(
  lines: SplittableLine[],
  stockMeters: number | string,
): SplitResult {
  if (lines.length === 0) return {};

  const stock = Math.max(roundMetres(stockMeters), 0);
  const result: SplitResult = {};
  let remaining = stock;

  const share = roundMetres(stock / lines.length);

  for (const line of lines) {
    const give = Math.max(
      Math.min(share, toMeters(line.outstanding_quantity), remaining),
      0,
    );
    result[line.order_item] = String(roundMetres(give));
    remaining = roundMetres(remaining - give);
  }

  // Hand the leftover to the biggest buyers first, as far as they can take it.
  // Ties keep the board's own order, so the suggestion is deterministic.
  const byPriority = [...lines].sort(
    (a, b) => (a.priority_rank ?? Number.MAX_SAFE_INTEGER) - (b.priority_rank ?? Number.MAX_SAFE_INTEGER),
  );

  for (const line of byPriority) {
    if (remaining <= 0) break;
    const room = roundMetres(
      toMeters(line.outstanding_quantity) - toMeters(result[line.order_item]),
    );
    const give = Math.min(room, remaining);
    if (give > 0) {
      result[line.order_item] = String(
        roundMetres(toMeters(result[line.order_item]) + give),
      );
      remaining = roundMetres(remaining - give);
    }
  }

  return result;
}

/**
 * The reasons a typed-in split could not be saved. Mirrors what the backend
 * rejects on confirm, so the admin sees the problem as a sentence on screen
 * instead of a failed request.
 */
export function splitProblems(
  lines: SplittableLine[],
  metres: Record<number, string>,
  stockMeters: number | string,
): string[] {
  const issues: string[] = [];
  const stock = roundMetres(stockMeters);
  const total = roundMetres(
    lines.reduce((sum, line) => sum + toMeters(metres[line.order_item]), 0),
  );

  if (lines.length === 0) {
    issues.push("Tick at least one order to pack for.");
  }

  for (const line of lines) {
    const given = toMeters(metres[line.order_item]);
    const outstanding = toMeters(line.outstanding_quantity);
    if (given <= 0) {
      issues.push(
        `${line.customer} (order #${line.order}) has no metres entered.`,
      );
    } else if (given > outstanding) {
      issues.push(
        `${line.customer} (order #${line.order}) only needs ${formatMeters(
          outstanding,
        )} m.`,
      );
    }
  }

  if (total > stock) {
    issues.push(
      `That is ${formatMeters(total)} m but only ${formatMeters(
        stock,
      )} m are on the roll.`,
    );
  }

  return issues;
}
