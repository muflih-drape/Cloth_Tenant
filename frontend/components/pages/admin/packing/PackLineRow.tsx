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
 * This is a shortcut to the packing board, not a second way of moving cloth: the
 * server builds a one-line packing round and confirms it through the same engine,
 * so the metres come off the roll, the allocation is recorded and the order log
 * gains an entry exactly as they would from `/admin/packing`. The board is still
 * there for splitting a roll across several orders.
 *
 * Every line packs itself with its own button, and the page stays in packing mode
 * afterwards so the admin can carry on with the rest.
 *
 * The figure is prefilled with what is already on this line, and the admin is free
 * to enter any amount: less than the line owes, leaving the remainder owed, or
 * more than it owes, since a roll is cut whole and rounding up is deliberate. Only
 * the cloth actually on the roll is a hard limit, and the server has the final say.
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
      // Both the line and the roll changed, so report them up rather than making
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

      {problem && (
        <p role="alert" className="mt-1.5 text-[11px] font-semibold text-red-600">
          {problem}
        </p>
      )}
    </div>
  );
}
