"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  History,
  Loader2,
  Package,
  Plus,
  Printer,
  RefreshCw,
  Scale,
} from "lucide-react";
import { rollApi } from "@/lib/api/item";
import { toastError, toastSuccess } from "@/lib/toast";
import { formatMeters } from "@/types/item";
import type {
  FabricRoll,
  RollHistoryEntry,
  VariantRollDraft,
  VariantRollsResponse,
} from "@/types/item";
import ReceiveRollsDialog from "./receiveRollsDialog";
import RollLabelDialog from "./rollLabelDialog";
import RollSummary from "./rollSummary";

interface Props {
  variantId: number;
  /** Colour label, used in headings and dialogs. */
  label: string;
  /**
   * Called after any change to the colour's stock, so the page can refresh the
   * read-only metre figure it shows next to the colour name.
   *
   * The roll count travels with it because the badge above the panel quotes the
   * same number: sending only the metres left the badge reading the count the
   * page loaded with, so it said "0 rolls" over a panel showing one.
   */
  onStockChanged?: (stockMeters: string, rollCount: number) => void;
}

/**
 * The physical rolls of one colour.
 *
 * This is the only place a roll-tracked colour's metre total changes: receiving
 * a delivery, correcting a miscount, printing the label that goes on the roll, and
 * seeing what has been cut off each roll. A colour that has no rolls keeps the
 * plain editable figure on the fabric form, so this panel is exactly the
 * physical-roll view and nothing else.
 */
export default function PhysicalRollsPanel({
  variantId,
  label,
  onStockChanged,
}: Props) {
  const [data, setData] = useState<VariantRollsResponse | null>(null);
  /**
   * Which colour the figures on screen belong to. Comparing it with the colour
   * being asked about is what drives the spinner, so switching colour shows it
   * again without a state write inside the effect.
   */
  const [shownVariant, setShownVariant] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [historyFor, setHistoryFor] = useState<FabricRoll | null>(null);
  const [labelFor, setLabelFor] = useState<FabricRoll | null>(null);
  const [adjusting, setAdjusting] = useState<number | null>(null);
  const [adjustValue, setAdjustValue] = useState("");

  /**
   * The parent's callback, held in a ref so it is not an effect dependency.
   *
   * The inventory page passes an inline arrow, so a new function arrives on every
   * render. Listed as a dependency it would restart this effect after every
   * load, and the load reports the figure back up, and the page re-renders --
   * an endless refetch. Reading it through a ref breaks that circle: the effect
   * depends on the colour alone, and still reaches the latest callback.
   */
  const notifyStock = useRef(onStockChanged);
  useEffect(() => {
    notifyStock.current = onStockChanged;
  }, [onStockChanged]);

  const fetchRolls = useCallback(
    () => rollApi.getForVariant(variantId),
    [variantId],
  );

  useEffect(() => {
    let cancelled = false;
    fetchRolls()
      .then((rolls) => {
        if (cancelled) return;
        setData(rolls);
        notifyStock.current?.(rolls.stock_meters, rolls.roll_count);
      })
      .catch((e) => {
        if (!cancelled) toastError("Failed to load rolls", e);
      })
      .finally(() => {
        if (!cancelled) setShownVariant(variantId);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchRolls, variantId]);

  /** The same read again, for the refresh button. */
  const load = async () => {
    try {
      const rolls = await fetchRolls();
      setData(rolls);
      notifyStock.current?.(rolls.stock_meters, rolls.roll_count);
    } catch (e) {
      toastError("Failed to load rolls", e);
    } finally {
      setShownVariant(variantId);
    }
  };

  const submitReceive = async (drafts: VariantRollDraft[]) => {
    if (drafts.length === 1) {
      await rollApi.receive(variantId, { meters: drafts[0].meters });
      toastSuccess(`Received ${formatMeters(drafts[0].meters)} m`);
    } else {
      const result = await rollApi.bulkReceive(variantId, drafts);
      toastSuccess(
        `Received ${result.created} rolls, ${formatMeters(result.total_meters)} m`,
      );
    }
    await load();
  };

  /**
   * Receiving always adds. A colour opened with a plain metre figure keeps it --
   * the API records that figure as a roll of its own, so it can still be cut and
   * still counts towards the roll total.
   */
  const handleReceive = async (drafts: VariantRollDraft[]) => {
    try {
      await submitReceive(drafts);
    } catch (e) {
      // Re-throw so the dialog can show the message beside the rows it came from.
      throw e;
    }
  };

  const handleAdjust = async (roll: FabricRoll) => {
    const delta = adjustValue.trim();
    if (Number(delta) === 0) {
      toastError("Enter a different figure to adjust this roll");
      return;
    }
    try {
      await rollApi.adjust(roll.id, delta);
      toastSuccess(`${roll.roll_number} adjusted`);
      setAdjusting(null);
      setAdjustValue("");
      await load();
    } catch (e) {
      toastError("Could not adjust this roll", e);
    }
  };

  if (shownVariant !== variantId) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400 px-1 py-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading rolls…
      </div>
    );
  }

  if (!data) return null;

  const rolls = data.rolls ?? [];
  const hasRolls = rolls.length > 0;

  return (
    <div className="border border-gray-100 rounded-2xl bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        aria-expanded={expanded}
      >
        <Package className="w-4 h-4 text-primary flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400">
            Physical Rolls
          </p>
          <p className="text-sm font-semibold text-gray-700">
            {hasRolls
              ? `Total: ${formatMeters(data.roll_stock_meters)} m · ${data.roll_count} roll${data.roll_count === 1 ? "" : "s"}`
              : "No rolls received yet"}
          </p>
        </div>
        {hasRolls && (
          <span className="text-[10px] uppercase tracking-wide text-gray-400 flex-shrink-0">
            {data.exhausted_roll_count} used up
          </span>
        )}
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-100">
          {hasRolls && (
            <div className="grid grid-cols-3 gap-2 pt-3 text-center">
              <Stat
                label="Received"
                metres={data.total_received_meters}
                hint="all time"
              />
              <Stat
                label="On hand"
                metres={data.roll_stock_meters}
                hint="on the rolls"
              />
              <Stat
                label="Packed out"
                metres={data.consumed_meters}
                hint="cut for orders"
              />
            </div>
          )}

          {hasRolls ? (
            <div className="space-y-1.5">
              {rolls.map((roll) => (
                <div
                  key={roll.id}
                  className="rounded-xl border border-gray-100 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <RollSummary roll={roll} />
                    <button
                      type="button"
                      onClick={() => setHistoryFor(roll)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/5 transition-colors"
                      aria-label={`History for ${roll.roll_number}`}
                      title="History"
                    >
                      <History className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setLabelFor(roll)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/5 transition-colors"
                      aria-label={`Print label for ${roll.roll_number}`}
                      title="View/print label"
                    >
                      <Printer className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAdjusting(adjusting === roll.id ? null : roll.id);
                        setAdjustValue("");
                      }}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/5 transition-colors"
                      aria-label={`Adjust ${roll.roll_number}`}
                      title="Adjust metres"
                    >
                      <Scale className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {adjusting === roll.id && (
                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-dashed border-gray-100">
                      <input
                        type="number"
                        step="0.001"
                        inputMode="decimal"
                        placeholder="e.g. -12.5 to correct, 10 to add"
                        value={adjustValue}
                        onChange={(e) => setAdjustValue(e.target.value)}
                        className="flex-1 h-9 rounded-lg border border-gray-200 px-3 text-xs outline-none focus:border-primary"
                        aria-label={`Adjustment for ${roll.roll_number}`}
                      />
                      <button
                        type="button"
                        onClick={() => handleAdjust(roll)}
                        className="h-9 px-3 rounded-lg bg-primary text-white text-xs font-bold disabled:opacity-40"
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        onClick={() => setAdjusting(null)}
                        className="h-9 px-3 rounded-lg border border-gray-200 text-xs font-semibold text-gray-500"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400 pt-3 leading-relaxed">
              Receiving a roll adds its metres to this colour&apos;s stock, and
              packing then cuts from the oldest roll first.
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setReceiveOpen(true)}
              className="flex-1 h-10 rounded-xl bg-primary text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-lg shadow-primary/20"
            >
              <Plus className="w-3.5 h-3.5" />
              Receive Rolls
            </button>
            <button
              type="button"
              onClick={load}
              className="h-10 px-3 rounded-xl border border-gray-200 text-gray-500 flex items-center gap-1.5"
              aria-label="Refresh rolls"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <ReceiveRollsDialog
        open={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        onConfirm={handleReceive}
        label={label}
      />

      {historyFor && (
        <RollHistoryDialog
          roll={historyFor}
          onClose={() => setHistoryFor(null)}
        />
      )}

      {labelFor && (
        <RollLabelDialog
          roll={labelFor}
          fabric={data.fabric || label}
          displayOrder={data.display_order}
          pricePerMeter={data.price_per_meter}
          onClose={() => setLabelFor(null)}
        />
      )}
    </div>
  );
}

function Stat({ label, metres, hint }: { label: string; metres: string; hint: string }) {
  return (
    <div className="rounded-xl bg-gray-50 px-2 py-2">
      <p className="text-[9px] uppercase tracking-widest text-gray-400">{label}</p>
      <p className="text-sm font-black text-gray-700">{formatMeters(metres)}</p>
      <p className="text-[10px] text-gray-400">{hint}</p>
    </div>
  );
}

function RollHistoryDialog({
  roll,
  onClose,
}: {
  roll: FabricRoll;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<RollHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  // Mounted fresh for each roll, so the previous roll's entries never show here.
  useEffect(() => {
    let cancelled = false;
    rollApi
      .history(roll.id)
      .then((res) => {
        if (!cancelled) setEntries(res.entries);
      })
      .catch((e) => {
        if (!cancelled) toastError("Failed to load roll history", e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roll]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm px-4 pb-8 sm:items-center sm:pb-0"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full sm:max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden">
        <div className="px-6 pt-6 pb-4">
          <h2 className="text-base font-black">{roll.roll_number} history</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {formatMeters(roll.remaining_meters)} m left of{" "}
            {formatMeters(roll.original_meters)} m
          </p>
        </div>
        <div className="h-px bg-gray-100" />

        <div className="px-6 py-4 max-h-[50vh] overflow-y-auto space-y-1.5">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading…
            </div>
          )}
          {!loading && entries && entries.length === 0 && (
            <p className="text-xs text-gray-400">
              Nothing has been cut from this roll yet.
            </p>
          )}
          {entries?.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center gap-2 rounded-xl border border-gray-100 px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-700 truncate">
                  {entry.customer ?? "Unknown customer"}
                  {entry.order ? ` · order #${entry.order}` : ""}
                </p>
                <p className="text-[11px] text-gray-400">
                  {entry.round ? `round #${entry.round}` : "manual adjustment"}
                  {entry.is_reversed && " · returned to the roll"}
                </p>
              </div>
              <span
                className={`text-xs font-bold ${
                  entry.is_reversed ? "text-gray-400" : "text-primary"
                }`}
              >
                {entry.is_reversed ? "+" : "−"}
                {formatMeters(entry.metres)} m
              </span>
            </div>
          ))}
        </div>

        <div className="px-6 pb-6">
          <button
            type="button"
            onClick={onClose}
            className="w-full h-12 rounded-2xl border-2 border-gray-200 text-sm font-bold text-gray-500 hover:bg-gray-50 transition-all active:scale-95"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
