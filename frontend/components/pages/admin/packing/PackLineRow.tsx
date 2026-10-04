"use client";

import { useState } from "react";
import { PackageCheck } from "lucide-react";
import { packingApi } from "@/lib/api/order";
import { toastErrorFromError, toastSuccess } from "@/lib/toast";
import { packLineProblems } from "@/lib/utils/packLine";
import { formatMeters, toMeters } from "@/types/item";
import type { OrderItem, PackLineResponse } from "@/types/order";

type Props = {
  orderId: number;
  line: OrderItem;
  /** Live on-hand metres for this line's colour, or null while still loading. */
  stockMeters: string | null;
  /**
   * The figure in the box, owned by the order page. Keeping it up there rather
   * than in this component means packing one line cannot disturb what the admin
   * has typed into the others.
   */
  metres: string;
  onMetresChange: (metres: string) => void;
  /** True once this line has been packed from packing mode. */
  justPacked: boolean;
  onPacked: (result: PackLineResponse) => void;
};

/**
 * The packing controls for one fabric line, rendered inside that line's own card.
 *
 * This is the *typed* path only: a colour with no physical rolls, whose stock is a
 * single figure, is packed by entering metres exactly as it always was.
 *
 * A colour with physical rolls is not packed from here. There is no figure to type
 * for it -- the roll itself is the unit, and typing one would mean telling the
 * server how much of a named roll to cut, which is not how cloth leaves a roll. So
 * those lines are packed by scanning the label on the roll, and that scan belongs to
 * a bundle on the order rather than to one line, because a box can carry rolls of
 * several colours and a mistake has to be undoable one roll at a time. See
 * `PackingBundlePanel`.
 *
 * Either way the movement is the same one the board would make: the server builds a
 * one-line packing round and confirms it through the same engine, so the stock rules,
 * the `Allocation` row, the `ALLOCATION_MADE` log entry and a cancellable round all
 * land as usual.
 */
export default function PackLineRow({
  orderId,
  line,
  stockMeters,
  metres,
  onMetresChange,
  justPacked,
  onPacked,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const stock = stockMeters === null ? null : String(stockMeters);
  const label = line.fabric_name_display || line.fabric_name;
  const packed = toMeters(line.allocated_quantity);
  // Floored at 0: packing may overshoot what was ordered, and a settled line
  // must never be shown as owing cloth back.
  const stillOwed = Math.max(toMeters(line.outstanding_quantity), 0);
  // The surplus when a roll was cut longer than the line was ordered for, so the
  // extra metres are visible rather than silently folded into the packed figure.
  const overOrdered = Math.max(packed - toMeters(line.ordered_quantity), 0);
  // Decided by the server, not guessed here: a colour has rolls or it does not.
  // A roll-tracked line is packed by scanning into a bundle instead, so there is no
  // input to offer it here.
  const rollTracked = line.is_roll_tracked === true;

  const handlePack = async () => {
    const issues = packLineProblems({
      metres,
      stockMeters: stock ?? 0,
      label,
    });
    if (issues.length > 0) {
      setProblem(issues[0]);
      return;
    }

    setBusy(true);
    setProblem(null);
    try {
      const result = await packingApi.packLine(orderId, line.id, metres);
      // Both the line and the stock changed, so report them up rather than making
      // the page refetch the whole order to redraw one row. The box keeps the
      // figure just packed, and the page stays in packing mode.
      onPacked(result);
      onMetresChange(metres);
      toastSuccess(
        `Packed ${formatMeters(metres)} m`,
        `${label} · ${formatMeters(result.stock_meters)} m left on the roll`,
      );
    } catch (err) {
      // The server's own wording, so a refusal reads as a sentence about this
      // order rather than a generic failure.
      toastErrorFromError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-gray-50 px-1 pt-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-medium text-gray-500">
        <span>{formatMeters(line.ordered_quantity)} m ordered</span>
        <span>{formatMeters(packed)} m packed</span>
        {overOrdered > 0 && (
          <span className="text-gray-500">
            +{formatMeters(overOrdered)} m over ordered
          </span>
        )}
        <span className="font-bold text-amber-600">
          {formatMeters(stillOwed)} m still owed
        </span>
        <span className="ml-auto text-gray-400">
          {stock === null
            ? "stock loading…"
            : `${formatMeters(stock)} m on the roll`}
        </span>
        {justPacked && (
          <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-bold text-green-700">
            Packed
          </span>
        )}
      </div>

      {!rollTracked && (
        <div className="mt-1.5 flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            step="0.001"
            min="0"
            value={metres}
            onChange={(e) => {
              onMetresChange(e.target.value);
              setProblem(null);
            }}
            disabled={busy}
            aria-label={`Metres of ${label} to pack`}
            className="w-28 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm font-semibold text-gray-900 focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:opacity-50"
          />
          <span className="text-xs font-medium text-gray-500">metres</span>
          <button
            type="button"
            onClick={handlePack}
            disabled={busy}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-amber-600 transition-colors disabled:opacity-50"
          >
            {busy ? (
              <span className="w-3 h-3 border-2 border-amber-200 border-t-white rounded-full animate-spin block" />
            ) : (
              <PackageCheck size={13} />
            )}
            Pack this line
          </button>
        </div>
      )}

      {rollTracked && (
        <p className="mt-1.5 text-[11px] font-medium text-gray-400">
          Packed by scanning the roll into a bundle above.
        </p>
      )}

      {problem && (
        <p role="alert" className="mt-1.5 text-[11px] font-semibold text-red-600">
          {problem}
        </p>
      )}
    </div>
  );
}
