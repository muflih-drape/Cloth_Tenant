"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Package,
  RotateCcw,
  Scissors,
} from "lucide-react";
import { packingApi } from "@/lib/api/order";
import { toastError, toastSuccess } from "@/lib/toast";
import {
  PackingPlan,
  PackingQueue,
  PackingRoundSummary,
  PlanOverrideEntry,
} from "@/types/order";
import { formatMeters, toMeters } from "@/types/item";
import { PageLoading } from "@/components/ui/Loading";

/**
 * The packing board: one fabric roll at a time.
 *
 * The queue is everyone still waiting for that colour, ranked by how much they
 * buy. Preview runs the allocation engine (equal fill, then the remainder to the
 * highest-priority customer) without writing anything, so the split can be
 * checked and hand-adjusted before a single metre moves. Freezing a plan creates
 * a DRAFT round; confirming it moves the stock.
 */
export default function PackingBoard({
  variantId,
  onDone,
}: {
  variantId: number;
  onDone?: () => void;
}) {
  const [queue, setQueue] = useState<PackingQueue | null>(null);
  const [plan, setPlan] = useState<PackingPlan | null>(null);
  const [roundSize, setRoundSize] = useState("");
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rounds, setRounds] = useState<PackingRoundSummary[]>([]);
  /** The round an action is currently in flight for, so buttons disable per-row. */
  const [busyRound, setBusyRound] = useState<number | null>(null);

  /**
   * Pure fetchers. They return data and never touch state, so the mount effect
   * and the post-action refresh share one code path without the effect setting
   * state synchronously.
   */
  const fetchQueue = useCallback(() => packingApi.queue(variantId), [variantId]);
  const fetchRounds = useCallback(
    () => packingApi.listRounds(variantId),
    [variantId],
  );

  /** Re-read the queue after an action changes stock or allocations. */
  const refresh = useCallback(async () => {
    const [nextQueue, nextRounds] = await Promise.allSettled([
      fetchQueue(),
      fetchRounds(),
    ]);

    if (nextQueue.status === "fulfilled") {
      setQueue(nextQueue.value);
      setError(null);
    } else {
      toastError("Could not load the packing queue", nextQueue.reason);
      setError("Could not load the packing queue.");
    }

    if (nextRounds.status === "fulfilled") {
      setRounds(nextRounds.value);
    } else {
      // A history panel is a convenience here; the queue is the real screen.
      console.error("Could not load packing rounds:", nextRounds.reason);
    }
  }, [fetchQueue, fetchRounds]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [nextQueue, nextRounds] = await Promise.allSettled([
        fetchQueue(),
        fetchRounds(),
      ]);
      if (cancelled) return;

      if (nextQueue.status === "fulfilled") {
        setQueue(nextQueue.value);
      } else {
        toastError("Could not load the packing queue", nextQueue.reason);
        setError("Could not load the packing queue.");
      }

      if (nextRounds.status === "fulfilled") {
        setRounds(nextRounds.value);
      } else {
        console.error("Could not load packing rounds:", nextRounds.reason);
      }

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchQueue, fetchRounds]);

  const runPreview = async () => {
    const size = toMeters(roundSize);
    if (size <= 0) {
      toastError("Enter how many metres this roll holds.");
      return;
    }
    setWorking(true);
    try {
      const result = await packingApi.preview({
        variant: variantId,
        round_size: roundSize,
      });
      setPlan(result);
      setOverrides({});
      setEditing(false);
    } catch (err) {
      toastError("Could not build a plan", err);
    } finally {
      setWorking(false);
    }
  };

  const hasOverrides = useMemo(
    () => Object.keys(overrides).length > 0,
    [overrides],
  );

  /**
   * The engine is the default, and the admin's hand-edits are sent as an
   * override. An untouched field falls back to the engine's figure, so a single
   * edit does not have to restate every line.
   */
  const effectiveMetres = useCallback(
    (orderItem: number, engineValue: string) => overrides[orderItem] ?? engineValue,
    [overrides],
  );

  const overrideTotal = useMemo(() => {
    if (!plan) return 0;
    return plan.allocations.reduce(
      (sum, entry) =>
        sum + toMeters(effectiveMetres(entry.order_item, entry.metres)),
      0,
    );
  }, [plan, effectiveMetres]);

  const stock = toMeters(queue?.variant.stock_meters);

  const freezeRound = async () => {
    if (!plan) return;
    setWorking(true);
    try {
      const allocations: PlanOverrideEntry[] = hasOverrides
        ? plan.allocations.map((entry) => ({
            order_item: entry.order_item,
            metres: effectiveMetres(entry.order_item, entry.metres),
          }))
        : [];

      const round = await packingApi.createRound({
        variant: variantId,
        round_size: plan.round_size,
        allocations,
      });

      // Keep the plan on screen so the same split can be confirmed straight
      // away, and refresh the saved list so the draft is not orphaned.
      setRoundSize(plan.round_size);
      setPlan(null);
      setOverrides({});
      setEditing(false);
      toastSuccess(
        `Saved a draft for ${formatMeters(plan.round_size)} m. Confirm it below to move the cloth.`,
      );
      await refresh();
      return round;
    } catch (err) {
      toastError("Could not save the packing round", err);
      return null;
    } finally {
      setWorking(false);
    }
  };

  /** Finish a round that was saved earlier, from the saved list. */
  const confirmSavedRound = async (round: PackingRoundSummary) => {
    setBusyRound(round.id);
    try {
      await packingApi.confirm(round.id);
      toastSuccess(
        `${formatMeters(round.total_allocated)} m allocated to the orders.`,
      );
      setConfirmed(true);
      setPlan(null);
      await refresh();
    } catch (err) {
      toastError("Could not confirm the packing round", err);
    } finally {
      setBusyRound(null);
    }
  };

  /**
   * Reverse a round. A draft simply stops existing; a confirmed one returns its
   * metres to the roll and rewinds the order lines it touched.
   */
  const cancelRound = async (round: PackingRoundSummary) => {
    const wasConfirmed = round.status === "CONFIRMED";
    const question = wasConfirmed
      ? `Cancel this round? ${formatMeters(round.total_allocated)} m goes back on the roll and the orders are un-allocated.`
      : "Discard this draft? Nothing has been moved yet.";
    if (!window.confirm(question)) return;

    setBusyRound(round.id);
    try {
      await packingApi.cancel(round.id);
      toastSuccess(
        wasConfirmed
          ? "Round cancelled. The metres are back on the roll."
          : "Draft discarded.",
      );
      await refresh();
    } catch (err) {
      toastError("Could not cancel the packing round", err);
    } finally {
      setBusyRound(null);
    }
  };

  const confirmRound = async () => {
    if (!plan) return;
    setWorking(true);
    try {
      const allocations: PlanOverrideEntry[] = hasOverrides
        ? plan.allocations.map((entry) => ({
            order_item: entry.order_item,
            metres: effectiveMetres(entry.order_item, entry.metres),
          }))
        : [];

      const round = await packingApi.createRound({
        variant: variantId,
        round_size: plan.round_size,
        allocations,
      });

      await packingApi.confirm(round.id);
      toastSuccess(`${formatMeters(overrideTotal)} m allocated and dispatched to the orders.`);
      setConfirmed(true);
      setPlan(null);
      setOverrides({});
      await refresh();
    } catch (err) {
      toastError("Could not confirm the packing round", err);
    } finally {
      setWorking(false);
    }
  };

  if (loading) return <PageLoading text="Loading the packing queue…" />;

  if (error || !queue) {
    return (
      <div className="p-8 text-center">
        <AlertTriangle size={40} className="mx-auto text-red-300 mb-3" />
        <p className="text-sm text-gray-500">{error}</p>
      </div>
    );
  }

  if (confirmed) {
    return (
      <div className="p-8 text-center space-y-4">
        <CheckCircle2 size={48} className="mx-auto text-green-500" />
        <div>
          <h2 className="text-lg font-bold text-gray-900">Packed</h2>
          <p className="text-sm text-gray-500 mt-1">
            {formatMeters(stock)} m remained on the roll.
          </p>
        </div>
        <button
          onClick={onDone}
          className="px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold"
        >
          Back to orders
        </button>
      </div>
    );
  }

  return (
    <div className="pb-24">
      {/* Header: which roll, and how much is left */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-3">
          {onDone && (
            <button
              onClick={onDone}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="Back"
            >
              <ArrowLeft size={18} className="text-gray-600" />
            </button>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-extrabold text-gray-900 truncate">
              {queue.variant.fabric}
            </h1>
            <p className="text-xs text-gray-400 truncate">
              {queue.variant.display_order || "No colour set"} ·{" "}
              ₹{Number(queue.variant.price_per_meter).toLocaleString("en-IN")}/m
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-black text-gray-900 leading-none">
              {formatMeters(queue.variant.stock_meters)} m
            </p>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">
              on the roll
            </p>
          </div>
        </div>
      </div>

      {/* Who is waiting, ranked by priority */}
      <div className="px-4 pt-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
            Waiting for this colour
          </h2>
          <span className="text-xs text-gray-400">
            {queue.outstanding_orders} order
            {queue.outstanding_orders !== 1 ? "s" : ""} ·{" "}
            {formatMeters(queue.total_outstanding_meters)} m owed
          </span>
        </div>

        {queue.lines.length === 0 ? (
          <div className="py-10 text-center">
            <Package size={36} className="mx-auto text-gray-200 mb-2" />
            <p className="text-sm text-gray-400">
              Nothing is waiting for this colour.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {queue.lines.map((line) => (
              <div
                key={line.order_item}
                className="flex items-center gap-2 p-2.5 rounded-xl border border-gray-100 bg-white"
              >
                <span
                  className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black flex-shrink-0 ${
                    line.priority_rank === 1
                      ? "bg-primary text-white"
                      : "bg-gray-100 text-gray-500"
                  }`}
                  title="Priority rank: who buys the most"
                >
                  {line.priority_rank ?? "–"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-gray-900 truncate">
                    {line.customer}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    Order #{line.order} · {formatMeters(line.metres_sold)} m
                    lifetime
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-black text-gray-900">
                    {formatMeters(line.outstanding_quantity)} m
                  </p>
                  <p className="text-[10px] text-gray-400">outstanding</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Plan the round */}
      {queue.lines.length > 0 && (
        <div className="px-4 pt-5">
          <label
            htmlFor="round-size"
            className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5"
          >
            Metres in this round
          </label>
          <div className="flex gap-2">
            <input
              id="round-size"
              type="number"
              inputMode="decimal"
              step="0.5"
              min="0"
              placeholder={formatMeters(queue.variant.stock_meters)}
              value={roundSize}
              onChange={(event) => {
                setRoundSize(event.target.value);
                setPlan(null);
              }}
              className="flex-1 px-3 py-2.5 bg-white border border-gray-200 rounded-xl font-medium text-gray-900 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
            <button
              onClick={runPreview}
              disabled={working}
              className="px-4 py-2.5 rounded-xl bg-black text-white text-sm font-bold flex items-center gap-2 disabled:opacity-50"
            >
              {working ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Scissors size={15} />
              )}
              Plan
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-gray-400">
            Everyone gets an equal share, then whatever is left over goes to the
            highest-priority customer.
          </p>
        </div>
      )}

      {/* The plan itself */}
      {plan && (
        <div className="px-4 pt-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              Proposed split
            </h2>
            <button
              onClick={() => setEditing((prev) => !prev)}
              className="text-xs font-bold text-primary"
            >
              {editing ? "Done editing" : "Adjust by hand"}
            </button>
          </div>

          <div
            className={`rounded-xl border p-3 mb-2 ${
              plan.fully_covered
                ? "bg-green-50 border-green-200"
                : "bg-amber-50 border-amber-200"
            }`}
          >
            <p className="text-xs font-bold text-gray-700">
              {plan.participants} waiting ·{" "}
              {formatMeters(overrideTotal)} m allocated of{" "}
              {formatMeters(plan.round_size)} m in this round
            </p>
            {!plan.fully_covered && (
              <p className="text-[11px] text-amber-700 mt-1">
                {formatMeters(plan.shortfall_meters)} m of demand will stay
                unfulfilled after this round.
              </p>
            )}
            {hasOverrides && (
              <p className="text-[11px] text-primary font-bold mt-1">
                Hand-adjusted — the engine&apos;s split will not be used.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            {plan.allocations.map((entry) => (
              <div
                key={entry.order_item}
                className="flex items-center gap-2 p-2.5 rounded-xl border border-gray-100 bg-white"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-gray-900 truncate">
                    {entry.customer}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    Owes {formatMeters(entry.outstanding_quantity)} m
                    {entry.is_priority_award && (
                      <span className="text-primary font-bold">
                        {" "}
                        · priority award
                      </span>
                    )}
                  </p>
                </div>
                {editing ? (
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    min="0"
                    value={effectiveMetres(entry.order_item, entry.metres)}
                    onChange={(event) =>
                      setOverrides((prev) => ({
                        ...prev,
                        [entry.order_item]: event.target.value,
                      }))
                    }
                    className="w-24 px-2 py-1.5 text-right bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-900 focus:outline-none focus:border-primary"
                  />
                ) : (
                  <span className="text-sm font-black text-gray-900 flex-shrink-0">
                    {formatMeters(effectiveMetres(entry.order_item, entry.metres))}{" "}
                    m
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-3 flex gap-2">
            <button
              onClick={freezeRound}
              disabled={working}
              className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-700 text-sm font-bold disabled:opacity-50"
            >
              Save as draft
            </button>
            <button
              onClick={confirmRound}
              disabled={working}
              className="flex-[2] py-3 rounded-xl bg-primary text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {working ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <CheckCircle2 size={16} />
              )}
              Confirm &amp; move {formatMeters(overrideTotal)} m
            </button>
          </div>
        </div>
      )}

      {confirmed && (
        <div className="px-4 pt-4 flex justify-center">
          <RotateCcw size={14} className="text-gray-300" />
        </div>
      )}

      {/* Saved rounds: finish or reverse one that was left part-done */}
      {rounds.length > 0 && (
        <div className="px-4 pt-5 pb-4">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
            Saved rounds
          </h2>
          <div className="space-y-1.5">
            {rounds.slice(0, 8).map((round) => {
              const isDraft = round.status === "DRAFT";
              const busy = busyRound === round.id;

              return (
                <div
                  key={round.id}
                  className={`flex items-center gap-2 p-2.5 rounded-xl border bg-white ${
                    isDraft ? "border-amber-200" : "border-gray-100"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-gray-900">
                      {formatMeters(round.total_allocated)} m of{" "}
                      {formatMeters(round.round_size)} m
                      <span
                        className={`ml-2 text-[10px] font-black uppercase ${
                          isDraft ? "text-amber-600" : "text-green-600"
                        }`}
                      >
                        {isDraft ? "draft" : "confirmed"}
                      </span>
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {round.confirmed_at
                        ? `Moved ${new Date(round.confirmed_at).toLocaleString("en-IN")}`
                        : `Saved ${new Date(round.created_at).toLocaleString("en-IN")}`}
                    </p>
                  </div>

                  {isDraft ? (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => confirmSavedRound(round)}
                        disabled={busy}
                        className="px-2.5 py-1.5 rounded-lg bg-primary text-white text-[11px] font-bold disabled:opacity-50"
                      >
                        {busy ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          "Confirm"
                        )}
                      </button>
                      <button
                        onClick={() => cancelRound(round)}
                        disabled={busy}
                        className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-500 text-[11px] font-bold disabled:opacity-50"
                      >
                        Discard
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => cancelRound(round)}
                      disabled={busy}
                      className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-500 text-[11px] font-bold disabled:opacity-50 flex-shrink-0"
                    >
                      {busy ? <Loader2 size={12} className="animate-spin" /> : "Reverse"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
