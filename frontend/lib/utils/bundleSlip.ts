/**
 * Reading a roll label, and the slip that comes out of a bundle.
 *
 * A roll's label is its primary key and nothing else. Anything that is not a plain
 * positive integer is some other kind of QR -- a fabric's own code, say -- and
 * saying so here is friendlier than sending it to the server to fail as a lookup
 * for a roll that does not exist.
 */

/** The roll a scan resolved to, or null when the payload is not a roll label. */
export function parseRollScan(raw: string): number | null {
  const value = Number(raw.trim());
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** Filename for a bundle's packing slip, safe to hand to a download attribute. */
export function bundleSlipFilename(code: string): string {
  const slug = code.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return `${slug}.pdf`;
}