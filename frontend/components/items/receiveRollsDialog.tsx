"use client";

import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";

export interface RollDraft {
  /** Metres entered for this roll; validated before anything is sent. */
  meters: string;
  note: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (rolls: RollDraft[]) => Promise<void>;
  /** Shown in the header, e.g. `Cotton Cambric — Natural`. */
  label?: string;
}

/**
 * Receive a delivery as one roll or several.
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
}: Props) {
  const [rolls, setRolls] = useState<RollDraft[]>([{ meters: "", note: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const setRoll = (index: number, patch: Partial<RollDraft>) => {
    setRolls((prev) =>
      prev.map((roll, i) => (i === index ? { ...roll, ...patch } : roll)),
    );
    setError("");
  };

  const addRoll = () => setRolls((prev) => [...prev, { meters: "", note: "" }]);

  const removeRoll = (index: number) =>
    setRolls((prev) =>
      prev.length === 1 ? prev : prev.filter((_, i) => i !== index),
    );

  /** Reject the same figures the backend would, before spending a request. */
  const validate = (): string => {
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
    }
    return "";
  };

  const total = rolls.reduce((sum, roll) => {
    const metres = Number(roll.meters);
    return sum + (Number.isFinite(metres) ? metres : 0);
  }, 0);

  const handleConfirm = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onConfirm(
        rolls.map((roll) => ({
          meters: roll.meters.trim(),
          note: roll.note.trim(),
        })),
      );
      setRolls([{ meters: "", note: "" }]);
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
              {label ? `${label} — ` : ""}one row per roll. Metres are added to
              this colour&apos;s stock as soon as they are received.
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

        <div className="px-6 py-5 space-y-3 max-h-[50vh] overflow-y-auto">
          {rolls.map((roll, index) => (
            <div key={index} className="flex items-center gap-2">
              <div className="flex-1">
                <Input
                  type="number"
                  min={0}
                  step="0.001"
                  inputMode="decimal"
                  placeholder="Metres"
                  value={roll.meters}
                  onChange={(e) => setRoll(index, { meters: e.target.value })}
                  disabled={saving}
                  className="h-10 text-sm"
                  aria-label={`Roll ${index + 1} metres`}
                />
              </div>
              <div className="flex-1">
                <Input
                  placeholder="Note (optional)"
                  value={roll.note}
                  onChange={(e) => setRoll(index, { note: e.target.value })}
                  disabled={saving}
                  className="h-10 text-sm"
                  aria-label={`Roll ${index + 1} note`}
                />
              </div>
              <button
                type="button"
                onClick={() => removeRoll(index)}
                disabled={saving || rolls.length === 1}
                className="p-2 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-30"
                aria-label={`Remove roll ${index + 1}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={addRoll}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-xl py-2.5 text-xs font-semibold text-gray-400 hover:border-primary hover:text-primary transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add another roll
          </button>

          {rolls.length > 1 && (
            <p className="text-right text-xs font-semibold text-gray-500">
              {rolls.length} rolls · {total || 0} m total
            </p>
          )}

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