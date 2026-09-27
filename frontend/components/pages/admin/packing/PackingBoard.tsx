"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Loader2,
  Package,
  RotateCcw,
  Scissors,
} from "lucide-react";
import { packingApi } from "@/lib/api/order";
import { toastError, toastSuccess } from "@/lib/toast";
import {
  splitEqually as splitEquallyForLines,
  splitProblems,
} from "@/lib/utils/packingSplit";
import {
  PackingQueue,
  PackingRoundSummary,
  PlanOverrideEntry,
} from "@/types/order";
import { formatMeters, roundMetres, toMeters } from "@/types/item";
import { PageLoading } from "@/components/ui/Loading";

/**
 * The packing board: one fabric roll at a time.
 *
 * The flow is deliberately hands-on. Pick the roll, tick the customers whose
 * orders this cloth is for, type how many metres each of them gets, read the
 * split back, then confirm. Selection is per order rather than per customer, so
 * a customer with two open orders for the same fabric can be packed for one of
 * them and left waiting on the other.
 *
 * Nothing moves until Confirm: the metres are only ever held in component state
 * until createRound freezes them, and the backend re-checks stock and demand at
 * that moment. "Split equally" prefills the inputs using the old allocation
 * rule -- an even share of the roll, then the remainder to whoever buys the most
 * -- but it is a starting point to edit, not an answer the admin is stuck with.
 */
export default function PackingBoard({
  variantId,
  onDone,
}: {
  variantId: number;
  onDone?: () => void;
}) {
  const [queue, setQueue] = useState<PackingQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rounds, setRounds] = useState<PackingRoundSummary[]>([]);
  /** The round an action is currently in flight for, so buttons disable per-row. */
  const [busyRound, setBusyRound] = useState<number | null>(null);

  /** Order lines ticked for this round, keyed by order line id. */
  const [selected, setSelected] = useState<Set<number>>(new Set());
  /** Metres typed per selected line. Unselected lines are absent. */
  const [rowMetres, setRowMetres] = useState<Record<number, string>>({});
  /** "select" shows the picker; "review" shows the split before committing. */
  const [stage, setStage] = useState<"select" | "review">("select");
  /**
   * Metres left on the roll, worked out at the moment the round was confirmed.
   * The queue refresh that follows lands a beat later, and reading the roll
   * from state before it arrives would report the pre-packing figure as if
   * nothing had moved.
   */
  const [leftOnRoll, setLeftOnRoll] = useState<string | null>(null);

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

  const stock = toMeters(queue?.variant.stock_meters);

  /** The ticked lines, in the queue's own priority order. */
  const picked = useMemo(
    () => (queue?.lines ?? []).filter((line) => selected.has(line.order_item)),
    [queue, selected],
  );

  const pickedTotal = useMemo(
    () =>
      roundMetres(
        picked.reduce((sum, line) => sum + toMeters(rowMetres[line.order_item]), 0),
      ),
    [picked, rowMetres],
  );

  /**
   * Everything that would make the server refuse the round, surfaced before the
   * admin gets that far. The backend re-checks all of it on confirm; this is
   * here so a mistake is a sentence on screen rather than a failed request.
   */
  const problems = useMemo(
    () => splitProblems(picked, rowMetres, stock),
    [picked, rowMetres, stock],
  );

  const canReview = picked.length > 0 && problems.length === 0;

  const toggleLine = (lineId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) {
        next.delete(lineId);
      } else {
        next.add(lineId);
      }
      return next;
    });
    setRowMetres((prev) => {
      if (prev[lineId] === undefined) return prev;
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
    setStage("select");
  };

  const clearSelection = () => {
    setSelected(new Set());
    setRowMetres({});
    setStage("select");
  };

  /**
   * Prefill the selected lines with the even-share rule the board used to apply
   * on its own. It only ever writes to the inputs, so every figure stays
   * editable afterwards.
   */
  const splitEqually = () => {
    setRowMetres(splitEquallyForLines(picked, stock));
    setStage("select");
  };

  /** The typed figures, in the shape createRound wants. */
  const buildAllocations = useCallback(
    (): PlanOverrideEntry[] =>
      picked
        .map((line) => ({
          order_item: line.order_item,
          metres: String(roundMetres(rowMetres[line.order_item])),
        }))
        .filter((entry) => toMeters(entry.metres) > 0),
    [picked, rowMetres],
  );

  /**
   * Freeze the typed split as a DRAFT round, or freeze it and confirm in one
   * go. The metres are sent explicitly rather than left for the engine, because
   * the admin has already said who gets what.
   */
  const commitRound = async (draftOnly: boolean) => {
    const allocations = buildAllocations();
    if (allocations.length === 0) {
      toastError("Enter metres for at least one order first.");
      return;
    }

    setWorking(true);
    try {
      const round = await packingApi.createRound({
        variant: variantId,
        round_size: String(pickedTotal),
        allocations,
      });

      if (draftOnly) {
        toastSuccess(
          `Saved a draft for ${formatMeters(pickedTotal)} m. Confirm it below to move the cloth.`,
        );
        clearSelection();
        await refresh();
        return;
      }

      await packingApi.confirm(round.id);
      toastSuccess(
        `${formatMeters(pickedTotal)} m allocated to the orders.`,
      );
      setLeftOnRoll(String(roundMetres(stock - pickedTotal)));
      setConfirmed(true);
      clearSelection();
      await refresh();
    } catch (err) {
      toastError(
        draftOnly
          ? "Could not save the packing round"
          : "Could not confirm the packing round",
        err,
      );
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
      setLeftOnRoll(
        String(roundMetres(stock - toMeters(round.total_allocated))),
      );
      setConfirmed(true);
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
            {formatMeters(leftOnRoll ?? stock)} m remained on the roll.
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

  const selectedLines = picked;
  const remainingAfter = roundMetres(stock - pickedTotal);

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

      {queue.lines.length === 0 ? (
        <div className="py-16 text-center">
          <Package size={36} className="mx-auto text-gray-200 mb-2" />
          <p className="text-sm text-gray-400">Nothing is waiting for this colour.</p>
        </div>
      ) : (
        <>
          {stage === "select" ? (
            <>
              {/* Step 1: tick the customers, then type their metres */}
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
                <p className="text-[11px] text-gray-400 mb-2">
                  Tick an order, then enter how many metres it gets from this
                  roll. A customer with two open orders appears twice, so you can
                  pack one and leave the other.
                </p>

                <div className="space-y-1.5">
                  {queue.lines.map((line) => {
                    const isSelected = selected.has(line.order_item);
                    return (
                      <div
                        key={line.order_item}
                        className={`rounded-xl border transition-colors ${
                          isSelected
                            ? "border-primary/40 bg-primary/[0.03]"
                            : "border-gray-100 bg-white"
                        }`}
                      >
                        <button
                          onClick={() => toggleLine(line.order_item)}
                          aria-pressed={isSelected}
                          className="w-full flex items-center gap-2 p-2.5 text-left"
                        >
                          <span
                            aria-hidden
                            className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border transition-colors ${
                              isSelected
                                ? "bg-primary border-primary text-white"
                                : "bg-white border-gray-300"
                            }`}
                          >
                            {isSelected && <Check size={13} strokeWidth={3} />}
                          </span>
                          <span
                            className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black flex-shrink-0 ${
                              line.priority_rank === 1
                                ? "bg-gray-900 text-white"
                                : "bg-gray-100 text-gray-500"
                            }`}
                            title="Priority rank: who buys the most"
                          >
                            {line.priority_rank ?? "–"}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-xs font-bold text-gray-900 truncate">
                              {line.customer}
                            </span>
                            <span className="block text-[10px] text-gray-400">
                              Order #{line.order} ·{" "}
                              {formatMeters(line.outstanding_quantity)} m
                              outstanding
                            </span>
                          </span>
                        </button>

                        {isSelected && (
                          <div className="px-2.5 pb-2.5 flex items-center gap-2">
                            <label
                              htmlFor={`metres-${line.order_item}`}
                              className="text-[10px] uppercase tracking-wider font-bold text-gray-400 flex-shrink-0"
                            >
                              Metres
                            </label>
                            <input
                              id={`metres-${line.order_item}`}
                              type="number"
                              inputMode="decimal"
                              step="0.5"
                              min="0"
                              autoFocus
                              placeholder="0"
                              value={rowMetres[line.order_item] ?? ""}
                              onChange={(event) => {
                                const value = event.target.value;
                                setRowMetres((prev) => ({
                                  ...prev,
                                  [line.order_item]: value,
                                }));
                              }}
                              className="w-24 px-2.5 py-2 text-right bg-white border border-gray-200 rounded-lg text-sm font-black text-gray-900 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                            />
                            <span className="text-[10px] text-gray-400 flex-shrink-0">
                              of {formatMeters(line.outstanding_quantity)} m needed
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Step 2: the running total, and the way through to review */}
              {picked.length > 0 && (
                <div className="px-4 pt-4">
                  <div
                    className={`rounded-xl border p-3 ${
                      problems.length === 0
                        ? "bg-green-50 border-green-200"
                        : "bg-amber-50 border-amber-200"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-700">
                        {picked.length} order
                        {picked.length !== 1 ? "s" : ""} selected
                      </span>
                      <span className="text-sm font-black text-gray-900">
                        {formatMeters(pickedTotal)} m
                        <span className="text-[10px] font-bold text-gray-400">
                          {" "}
                          of {formatMeters(stock)} m
                        </span>
                      </span>
                    </div>
                    {problems.map((issue) => (
                      <p
                        key={issue}
                        className="text-[11px] text-amber-700 mt-1 font-medium"
                      >
                        {issue}
                      </p>
                    ))}
                    {problems.length === 0 && (
                      <p className="text-[11px] text-green-700 mt-1">
                        {formatMeters(remainingAfter)} m will stay on the roll.
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={splitEqually}
                      className="px-3 py-2.5 rounded-xl border border-gray-200 text-gray-700 text-xs font-bold flex items-center gap-1.5"
                    >
                      <Scissors size={14} />
                      Split equally
                    </button>
                    <button
                      onClick={clearSelection}
                      className="px-3 py-2.5 rounded-xl border border-gray-200 text-gray-500 text-xs font-bold"
                    >
                      Clear
                    </button>
                    <button
                      onClick={() => setStage("review")}
                      disabled={!canReview}
                      className="flex-1 py-2.5 rounded-xl bg-black text-white text-sm font-bold disabled:opacity-40"
                    >
                      Review
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Step 3: read the split back before any cloth moves */
            <div className="px-4 pt-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                  Review this round
                </h2>
                <button
                  onClick={() => setStage("select")}
                  className="text-xs font-bold text-primary"
                >
                  Change
                </button>
              </div>

              <div className="rounded-xl border border-green-200 bg-green-50 p-3 mb-2">
                <p className="text-xs font-bold text-gray-700">
                  {selectedLines.length} order
                  {selectedLines.length !== 1 ? "s" : ""} ·{" "}
                  {formatMeters(pickedTotal)} m will move off the roll
                </p>
                <p className="text-[11px] text-green-700 mt-1">
                  {formatMeters(remainingAfter)} m stays on the roll.
                </p>
              </div>

              <div className="space-y-1.5">
                {selectedLines.map((line) => (
                  <div
                    key={line.order_item}
                    className="flex items-center gap-2 p-2.5 rounded-xl border border-gray-100 bg-white"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-900 truncate">
                        {line.customer}
                      </p>
                      <p className="text-[10px] text-gray-400">
                        Order #{line.order} · needs{" "}
                        {formatMeters(line.outstanding_quantity)} m
                      </p>
                    </div>
                    <span className="text-sm font-black text-gray-900 flex-shrink-0">
                      {formatMeters(rowMetres[line.order_item])} m
                    </span>
                  </div>
                ))}
              </div>

              <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-3 flex gap-2">
                <button
                  onClick={() => commitRound(true)}
                  disabled={working}
                  className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-700 text-sm font-bold disabled:opacity-50"
                >
                  Save as draft
                </button>
                <button
                  onClick={() => commitRound(false)}
                  disabled={working}
                  className="flex-[2] py-3 rounded-xl bg-primary text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {working ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={16} />
                  )}
                  Confirm &amp; move {formatMeters(pickedTotal)} m
                </button>
              </div>
            </div>
          )}
        </>
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
