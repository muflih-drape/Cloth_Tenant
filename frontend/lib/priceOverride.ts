/**
 * Validation for the pre-placement order total an agent may agree with a
 * customer.
 *
 * The server is authoritative -- it caps an agent at the line arithmetic and
 * caps nobody above it but the API. These checks exist so the dialog can
 * explain the problem in place instead of bouncing a round trip off the API,
 * and so the same rules are unit-testable without rendering anything.
 */

export interface PriceOverrideInput {
  /** Whatever is in the total field, still a raw string. */
  raw: string;
  /** The order total straight from the line arithmetic. */
  computedTotal: number;
  /** Admins may raise a total; agents may only reduce it. */
  canRaise: boolean;
}

export type PriceOverrideValidation =
  | { ok: true; total: number }
  | { ok: false; error: string };

const REASON_MAX = 200;

export function validatePriceOverride({
  raw,
  computedTotal,
  canRaise,
}: PriceOverrideInput): PriceOverrideValidation {
  const trimmed = raw.trim();

  if (!trimmed) return { ok: false, error: "Enter a total" };

  // Reject anything that is not a plain amount before handing it to Number(),
  // so "12abc" and "1e5" cannot slip through as a finite number. A leading
  // minus is allowed through so the negative case gets its own clearer message.
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) {
    return { ok: false, error: "Enter a valid amount, up to two decimals" };
  }

  const total = Number(trimmed);
  if (!Number.isFinite(total)) {
    return { ok: false, error: "Enter a valid amount, up to two decimals" };
  }

  if (total < 0) return { ok: false, error: "The total cannot be negative" };

  if (!canRaise && total > computedTotal) {
    return {
      ok: false,
      error: `An agent total cannot be higher than the order total of ${formatRupees(computedTotal)}`,
    };
  }

  return { ok: true, total };
}

/** The reason is optional, but the API still caps its length. */
export function validateOverrideReason(raw: string): string | null {
  return raw.trim().length > REASON_MAX
    ? `Keep the reason under ${REASON_MAX} characters`
    : null;
}

/**
 * True when the typed total is worth saving -- either it differs from the line
 * arithmetic, or there is an existing adjustment it would undo. Used to keep
 * the save button from firing a pointless request.
 */
export function hasMeaningfulChange(
  total: number,
  computedTotal: number,
  isCurrentlyOverridden: boolean,
): boolean {
  return isCurrentlyOverridden || round2(total) !== round2(computedTotal);
}

/** The discount a total represents, as a whole-number percentage. */
export function discountPercent(total: number, computedTotal: number): number {
  if (computedTotal <= 0 || total > computedTotal) return 0;
  return Math.round(((computedTotal - total) / computedTotal) * 100);
}

export function formatRupees(value: number): string {
  return `₹${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
