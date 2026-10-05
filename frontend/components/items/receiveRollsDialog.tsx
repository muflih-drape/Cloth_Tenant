"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatMeters, roundMetres, type VariantRollDraft } from "@/types/item";

/** One editable row: a length, and how many rolls of that length. */
export interface RollDraft {
  /** Metres entered for this roll; validated before anything is sent. */
  meters: string;
  /** How many rolls of this length. Blank counts as one. */
  count: string;
}

/** Ceilings so one delivery cannot ask for an unbounded number of rolls. */
const MAX_ROLLS_PER_ROW = 500;
const MAX_ROLLS_PER_DELIVERY = 1000;

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * One entry per real roll, the counts already expanded. Callers post this
   * straight to the API, so a row entered as `100 m x5` arrives as five rolls.
   */
  onConfirm: (rolls: VariantRollDraft[]) => Promise<void>;
  /** Shown in the header, e.g. `Cotton Cambric — Natural`. */
  label?: string;
  /**
   * Rolls to start from. Without this the rows always came up blank, so opening
   * a colour that already had its rolls typed in started from nothing.
   */
  initialRolls?: VariantRollDraft[];
}

/** A fresh row: one roll, no length typed yet. */
const blankRow = (): RollDraft => ({ meters: "", count: "1" });

/** Existing rolls become rows of one each, since that is how they were entered. */
const toRows = (rolls?: VariantRollDraft[]): RollDraft[] =>
  rolls?.length ? rolls.map((roll) => ({ ...roll, count: "1" })) : [blankRow()];

/** How many rolls a row stands for. Blank means the one roll it shows. */
export function rollCount(draft: RollDraft): number {
  const raw = draft.count.trim();
  if (raw === "") return 1;
  const count = Number(raw);
  return Number.isFinite(count) ? count : 0;
}

/**
 * Receive a delivery as one roll or several.
 *
 * A row is a length and how many rolls of it, because a factory delivery is
 * usually several rolls of the same length: `100 m x5` rather than five rows of
 * `100 m`. The counts are expanded here into one entry per roll, so the API, the
 * create form and the warehouse all still deal in real rolls.
 *
 * The whole delivery is sent in one request: the backend creates every roll and
 * adds every metre inside a single transaction, so a bad figure halfway down the
 * list leaves the warehouse exactly as it was rather than half-received.
 */
export default function ReceiveRollsDialog({
  open,
  onClose,
  onConfirm,
  label,
  initialRolls,
}: Props) {
  const [rolls, setRolls] = useState<RollDraft[]>(toRows(initialRolls));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  /**
   * The rolls to start from, read through a ref so that only opening the dialog
   * reseeds the rows. Depending on the prop itself would also reseed whenever the
   * page rebuilt the array, which on the colour screen happens as the admin types
   * -- wiping the row being typed.
   */
  const seed = useRef(initialRolls);
  useEffect(() => {
    seed.current = initialRolls;
  }, [initialRolls]);

  /**
   * Reseeded on the way in, so reopening the dialog shows the rolls the colour
   * already has rather than the last thing typed into a closed one.
   */
  useEffect(() => {
    if (open) {
      setRolls(toRows(seed.current));
      setError("");
    }
  }, [open]);

  if (!open) return null;

  const setRoll = (index: number, patch: Partial<RollDraft>) => {
    setRolls((prev) =>
      prev.map((roll, i) => (i === index ? { ...roll, ...patch } : roll)),
    );
    setError("");
  };

  const addRoll = () => setRolls((prev) => [...prev, blankRow()]);

  const removeRoll = (index: number) =>
    setRolls((prev) =>
      prev.length === 1 ? prev : prev.filter((_, i) => i !== index),
    );

  /** Reject the same figures the backend would, before spending a request. */
  const validate = (): string => {
    let totalRolls = 0;
    for (let i = 0; i < rolls.length; i++) {
      const raw = rolls[i].meters.trim();
      const metres = Number(raw);
      if (raw === "" || !Number.isFinite(metres)) {
        return `Roll ${i + 1}: enter how many metres it holds.`;
      }
      if (metres <= 0) {
        return `Roll ${i + 1}: metres must be greater than zero.`;
      }
      if (metres > 99999999999.999) {
        return `Roll ${i + 1}: that is more metres than a roll can hold.`;
      }
      const rawCount = rolls[i].count.trim();
      if (rawCount !== "") {
        const count = Number(rawCount);
        if (!Number.isFinite(count) || !Number.isInteger(count)) {
          return `Roll ${i + 1}: how many rolls must be a whole number.`;
        }
        if (count < 1) {
          return `Roll ${i + 1}: enter at least one roll.`;
        }
        if (count > MAX_ROLLS_PER_ROW) {
          return `Roll ${i + 1}: that is more rolls than one delivery can hold.`;
        }
      }
      // Blank means the one roll the row shows, so it still counts.
      totalRolls += rollCount(rolls[i]);
    }
    if (totalRolls > MAX_ROLLS_PER_DELIVERY) {
      return `That is ${totalRolls} rolls. Receive at most ${MAX_ROLLS_PER_DELIVERY} at a time.`;
    }
    return "";
  };

  /** The rows expanded into one entry per real roll, for the API. */
  const expanded: VariantRollDraft[] = rolls.flatMap((roll) => {
    const meters = roll.meters.trim();
    return Array.from({ length: Math.max(1, rollCount(roll)) }, () => ({
      meters,
    }));
  });

  const total = roundMetres(
    rolls.reduce((sum, roll) => {
      const metres = Number(roll.meters);
      if (!Number.isFinite(metres)) return sum;
      return sum + metres * Math.max(1, rollCount(roll));
    }, 0),
  );

  const handleConfirm = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onConfirm(expanded);
      setRolls([blankRow()]);
      onClose();
    } catch (e: unknown) {
      // The server's wording where it gave one, so a refusal reads as a sentence
      // about the delivery rather than a generic failure.
      const data = (
        e as
          | { response?: { data?: { error?: string; detail?: string } } }
          | undefined
      )?.response?.data;
      setError(data?.error || data?.detail || "Could not receive these rolls.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm px-4 pb-8 sm:items-center sm:pb-0"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="w-full sm:max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between px-6 pt-6 pb-4">
          <div>
            <h2 className="text-base font-black">Receive Rolls</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {label ? `${label} — ` : ""}one row per roll length, with how many
              rolls of it. Metres are added to this colour&apos;s stock as soon as
              they are received.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="h-px bg-gray-100" />

        <div className="px-6 py-5 space-y-2 max-h-[50vh] overflow-y-auto">
          {rolls.map((roll, index) => {
            const count = Math.max(1, rollCount(roll));
            return (
              <div key={index} className="flex items-center gap-2">
                <span className="w-6 text-xs font-bold text-gray-300 flex-shrink-0">
                  {index + 1}
                </span>
                <Input
                  type="number"
                  min={0}
                  step="0.001"
                  inputMode="decimal"
                  placeholder="Metres"
                  value={roll.meters}
                  onChange={(e) => setRoll(index, { meters: e.target.value })}
                  onFocus={(e) => e.target.select()}
                  disabled={saving}
                  className="h-10 text-sm"
                  aria-label={`Roll ${index + 1} metres`}
                />
                <span className="text-xs text-gray-300 flex-shrink-0">×</span>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={roll.count}
                  onChange={(e) => setRoll(index, { count: e.target.value })}
                  onFocus={(e) => e.target.select()}
                  disabled={saving}
                  className="h-10 text-sm w-16 flex-shrink-0"
                  aria-label={`Roll ${index + 1} count`}
                />
                <button
                  type="button"
                  onClick={() => removeRoll(index)}
                  disabled={saving || rolls.length === 1}
                  className="p-2 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-30"
                  aria-label={`Remove roll ${index + 1}`}
                >
                  <X className="w-4 h-4" />
                </button>
                {count > 1 && (
                  // Only worth saying once a row really is several rolls.
                  <span className="text-[11px] text-gray-400 flex-shrink-0">
                    = {count} rolls
                  </span>
                )}
              </div>
            );
          })}

          <button
            type="button"
            onClick={addRoll}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-xl py-2.5 text-xs font-semibold text-gray-400 hover:border-primary hover:text-primary transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add another length
          </button>

          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-gray-400">
              {/* Rolls, not rows: one row can stand for several rolls. */}
              {expanded.length} roll{expanded.length === 1 ? "" : "s"}
            </p>
            <p className="text-xs font-semibold text-gray-500">
              {formatMeters(String(total))} m total
            </p>
          </div>

          {error && (
            <p className="text-xs font-semibold text-red-500 bg-red-50 py-2 px-3 rounded-xl">
              {error}
            </p>
          )}
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 h-12 rounded-2xl border-2 border-gray-200 text-sm font-bold text-gray-500 hover:bg-gray-50 transition-all active:scale-95 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving}
            className="flex-1 h-12 rounded-2xl bg-primary text-sm font-bold text-white flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-40 shadow-lg shadow-primary/20"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Plus className="w-4 h-4" />
                Receive
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}