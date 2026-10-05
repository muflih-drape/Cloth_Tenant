import { formatMeters, roundMetres } from "@/types/item";

/**
 * One gram, i.e. 0.001 m at the three decimals the backend stores metres at.
 * Anything below this is a rounding artefact rather than cloth somebody cut.
 * Mirrors `MIN_ORDER_METERS` on the backend.
 */
export const MIN_PACK_METERS = 0.001;

/** The figures the order page holds for one line, and the live roll behind it. */
export interface PackLineContext {
  /** How many metres the admin typed in. */
  metres: string;
  /** What is on the roll right now. */
  stockMeters: string | number;
  /** Used to make the messages name the line, e.g. "Cotton Cambric 140 GSM". */
  label?: string;
}

/**
 * Whether to offer this line a packing control.
 *
 * A line is packable while the order is still open for cloth (`PENDING`, `PACKED`
 * or `PARTIALLY_DISPATCHED`, mirroring the engine's `OPEN_STATUSES`) and the line
 * still owes something. A partly dispatched order counts: its bundles have gone but
 * it still owes cloth, and it still has sealed bundles waiting to go out. Lines with
 * no colour attached can never be packed, because there is no roll to take the metres
 * off. A line already settled is not offered the control either -- over-packing a
 * finished line is allowed by the server, but there is nothing to prompt it, and the
 * settled rows should stay settled.
 */
export function isPackable(
  outstanding: string | number,
  stockMeters: string | number,
): boolean {
  return roundMetres(outstanding) > 0 && roundMetres(stockMeters) > 0;
}

/**
 * What to offer the admin as a starting figure: everything this line still owes,
 * or everything left on the roll, whichever is smaller.
 *
 * Prefilling the full outstanding quantity when the mill cannot cover it would
 * set the admin up to fail, and prefilling nothing makes them do the arithmetic
 * the screen already knows. Quantised with `roundMetres` so the suggestion can
 * never disagree with the server by a rounding error.
 */
export function prefillPackMetres(
  outstanding: string | number,
  stockMeters: string | number,
): string {
  const give = Math.min(
    roundMetres(outstanding),
    Math.max(roundMetres(stockMeters), 0),
  );
  return String(Math.max(give, 0));
}

/**
 * The reasons a typed-in figure could not be packed, as sentences.
 *
 * Physical stock is the only hard limit, so a figure larger than what the line
 * owes is perfectly packable -- a roll is cut whole and rounding up is deliberate.
 * These mirror what the endpoint refuses, so the admin reads the problem before
 * spending a request on it. The server still enforces it -- this is a courtesy, not
 * the rule.
 */
export function packLineProblems({
  metres,
  stockMeters,
  label = "this line",
}: PackLineContext): string[] {
  const issues: string[] = [];
  const given = roundMetres(metres);
  const stock = roundMetres(stockMeters);

  if (given < MIN_PACK_METERS) {
    issues.push(`Enter how many metres to pack for ${label}.`);
  } else if (given > stock) {
    issues.push(
      `That is ${formatMeters(given)} m but only ${formatMeters(
        stock,
      )} m are on the roll.`,
    );
  }

  return issues;
}

/** The stock figures after a pack, merged into whatever the page already had. */
export function applyPackStock(
  stock: Record<number, string>,
  variantId: number | null,
  stockMeters: string,
): Record<number, string> {
  if (variantId === null) return stock;
  return { ...stock, [variantId]: stockMeters };
}
