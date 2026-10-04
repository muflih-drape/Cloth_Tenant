import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getRolls,
  invalidateRolls,
  invalidateRollsFor,
  peekRolls,
  primeRolls,
} from "@/lib/rollsCache";
import { rollApi } from "@/lib/api/item";
import type { VariantRollsResponse } from "@/types/item";

vi.mock("@/lib/api/item", () => ({
  rollApi: {
    getForVariant: vi.fn(),
  },
}));

const getForVariant = vi.mocked(rollApi.getForVariant);

function response(over: Partial<VariantRollsResponse> = {}): VariantRollsResponse {
  return {
    variant: 7,
    fabric: "Cotton Checks",
    display_order: "green",
    price_per_meter: "9.00",
    stock_meters: "140.000",
    is_roll_tracked: true,
    roll_count: 1,
    active_roll_count: 1,
    exhausted_roll_count: 0,
    total_received_meters: "100.000",
    roll_stock_meters: "100.000",
    consumed_meters: "0.000",
    largest_roll_meters: "100.000",
    smallest_roll_meters: "100.000",
    rolls: [],
    ...over,
  } as VariantRollsResponse;
}

/** Resolves only when the returned function is called. */
function deferred<T>() {
  let release: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  // A cache that outlives a test would make the next one pass for the wrong
  // reason.
  invalidateRolls();
});

describe("rollsCache", () => {
  it("reads a colour once and serves the repeat from memory", async () => {
    getForVariant.mockResolvedValue(response());

    const first = await getRolls(7);
    const second = await getRolls(7);

    expect(getForVariant).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("keeps colours apart", async () => {
    getForVariant.mockImplementation((id) =>
      Promise.resolve(response({ variant: id })),
    );

    await getRolls(7);
    await getRolls(8);

    expect(getForVariant).toHaveBeenCalledTimes(2);
    expect((await getRolls(8)).variant).toBe(8);
    expect(getForVariant).toHaveBeenCalledTimes(2);
  });

  it("sends one request when a colour is asked for twice at once", async () => {
    // The hover prefetch and the click that follows it land in the same tick far
    // more often than not.
    const { promise, release } = deferred<VariantRollsResponse>();
    getForVariant.mockReturnValue(promise);

    const a = getRolls(7);
    const b = getRolls(7);
    release(response());
    const [ra, rb] = await Promise.all([a, b]);

    expect(getForVariant).toHaveBeenCalledTimes(1);
    expect(ra).toBe(rb);
  });

  it("reads again once the cached read is stale", async () => {
    vi.useFakeTimers();
    getForVariant.mockResolvedValue(response());

    await getRolls(7);
    // Just inside the lifetime: still served from memory.
    vi.advanceTimersByTime(29_000);
    await getRolls(7);
    expect(getForVariant).toHaveBeenCalledTimes(1);

    // Past it: the rolls may have been received or packed since.
    vi.advanceTimersByTime(2_000);
    await getRolls(7);
    expect(getForVariant).toHaveBeenCalledTimes(2);
  });

  it("offers what it holds without reading, and nothing before the first read", async () => {
    getForVariant.mockResolvedValue(response());

    expect(peekRolls(7)).toBeNull();

    const read = await getRolls(7);

    expect(peekRolls(7)).toBe(read);
    expect(getForVariant).toHaveBeenCalledTimes(1);
  });

  it("warms a colour on hover without the caller waiting", async () => {
    getForVariant.mockResolvedValue(response());

    primeRolls(7);
    // The point of priming: by the time the card is opened it is already there.
    await vi.waitFor(() => expect(peekRolls(7)).not.toBeNull());
    expect(getForVariant).toHaveBeenCalledTimes(1);
  });

  it("swallows a failed prefetch, so the open that follows still tries", async () => {
    getForVariant.mockRejectedValueOnce(new Error("offline"));

    expect(() => primeRolls(7)).not.toThrow();
    await vi.waitFor(() => expect(getForVariant).toHaveBeenCalledTimes(1));

    // A failure caches nothing, so a colour is never remembered as empty.
    getForVariant.mockResolvedValue(response());
    const read = await getRolls(7);
    expect(read.roll_count).toBe(1);
    expect(getForVariant).toHaveBeenCalledTimes(2);
  });

  it("rejects rather than resolving empty when a read fails", async () => {
    getForVariant.mockRejectedValue(new Error("offline"));

    await expect(getRolls(7)).rejects.toThrow("offline");
    expect(peekRolls(7)).toBeNull();
  });

  it("forgets one colour, or all of them", async () => {
    getForVariant.mockResolvedValue(response());

    await getRolls(7);
    await getRolls(8);

    invalidateRollsFor(7);
    expect(peekRolls(7)).toBeNull();
    expect(peekRolls(8)).not.toBeNull();

    await getRolls(7);
    expect(getForVariant).toHaveBeenCalledTimes(3);

    // What the Inventory page does when the tab regains focus.
    invalidateRolls();
    expect(peekRolls(8)).toBeNull();
    expect(peekRolls(7)).toBeNull();
  });
});