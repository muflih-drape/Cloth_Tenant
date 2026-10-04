import { rollApi } from "@/lib/api/item";
import type { VariantRollsResponse } from "@/types/item";

/**
 * One read of a colour's rolls, shared by every card that shows them.
 *
 * The Inventory page opens one card at a time, and before this existed each open
 * asked the server again -- so walking down a fabric's colours cost a round trip
 * per colour and showed a spinner for each one, which on a warehouse phone is the
 * difference between instant and unusable.
 *
 * Two things make the repeat free:
 *
 * - a short lifetime, so a colour re-opened within {@link ROLLS_TTL_MS} reads
 *   from memory, and
 * - request de-duplication, so a colour asked for twice at once -- a prefetch on
 *   hover landing in the same tick as the click -- waits on one request rather
 *   than sending two.
 *
 * The lifetime matches the Inventory page's own 30-second stock refresh, so
 * rolls are never older than the metre figures printed beside them. Anything that
 * changes rolls invalidates the cache outright rather than waiting it out.
 */

const ROLLS_TTL_MS = 30_000;

type Entry = {
  /** When this read was fetched, for the lifetime check. */
  at: number;
  /** The in-flight request, so a second caller joins this one. */
  pending: Promise<VariantRollsResponse> | null;
  /** The last good read, or null if this colour has never been read. */
  value: VariantRollsResponse | null;
};

const cache = new Map<number, Entry>();

function entryFor(variantId: number): Entry {
  let entry = cache.get(variantId);
  if (!entry) {
    entry = { at: 0, pending: null, value: null };
    cache.set(variantId, entry);
  }
  return entry;
}

/**
 * A colour's rolls, from memory when they are still fresh.
 *
 * Rejects on the server's error, having cached nothing, so a colour that failed
 * to load is retried on the next open rather than remembered as empty.
 */
export function getRolls(variantId: number): Promise<VariantRollsResponse> {
  const entry = entryFor(variantId);
  const value = entry.value;
  if (value !== null && Date.now() - entry.at < ROLLS_TTL_MS) {
    return Promise.resolve(value);
  }
  if (entry.pending) return entry.pending;

  const pending = rollApi.getForVariant(variantId).then(
    (rolls) => {
      entry.value = rolls;
      entry.at = Date.now();
      // Cleared here rather than in a finally(): a caller that asks again in the
      // same tick must see a settled entry, not join a request that has already
      // answered -- which is what would keep a stale read alive.
      entry.pending = null;
      return rolls;
    },
    (error) => {
      // Nothing cached, so the next open asks again rather than showing a colour
      // as having no rolls because the network blinked.
      entry.value = null;
      entry.pending = null;
      throw error;
    },
  );
  entry.pending = pending;

  return pending;
}

/**
 * Start reading a colour before it is asked for, without waiting on it.
 *
 * Called when the pointer lands on a card: by the time the click is made the
 * rolls have usually landed too, so the card opens on what is already in memory.
 */
export function primeRolls(variantId: number): void {
  void getRolls(variantId).catch(() => {
    // A prefetch that fails is not worth a toast: the open that follows will
    // report it in the place the admin is looking.
  });
}

/**
 * The last read of a colour, or null if it has not been read yet.
 *
 * Lets a screen that opens a card render its rolls on the spot instead of showing
 * a spinner for a figure it already holds.
 */
export function peekRolls(variantId: number): VariantRollsResponse | null {
  const entry = cache.get(variantId);
  if (!entry || entry.value === null) return null;
  return Date.now() - entry.at < ROLLS_TTL_MS ? entry.value : null;
}

/** Forget every colour's rolls, so the next open reads the server. */
export function invalidateRolls(): void {
  cache.clear();
}

/** Forget one colour's rolls. */
export function invalidateRollsFor(variantId: number): void {
  cache.delete(variantId);
}