"use client";

import { useState } from "react";
import { PackageCheck, QrCode, Undo2 } from "lucide-react";
import QRScanModal from "@/components/items/QRScanModal";
import { packingApi } from "@/lib/api/order";
import { toastError, toastErrorFromError, toastSuccess } from "@/lib/toast";
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
 * There are two of them, and which one a line gets is decided by the colour rather
 * than by the admin.
 *
 * A colour with **physical rolls** is packed by scanning: the admin picks up the
 * roll, scans the label on it, and that whole roll is cut for the line. There is no
 * figure to type, because typing one would mean telling the server how much of a
 * named roll to cut, and the roll in the warehouse is never cut that way. The scan
 * names the roll, so there is nothing to get wrong, and the server refuses a label
 * belonging to another colour or a roll that is already used up. "Undo last scan"
 * puts the most recent one back on the roll it came off, which is the mistake worth
 * making easy to take back: the wrong roll scanned against the wrong line.
 *
 * A colour with **no rolls** is packed by typing metres, exactly as it always was.
 * Its stock is a single figure, so there is no roll to name.
 *
 * Both paths really do move cloth, so the server builds a one-line packing round
 * and confirms it through the same engine: same stock rules, same `Allocation` row,
 * same `ALLOCATION_MADE` log entry, and a round that can still be cancelled.
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
  const [scanOpen, setScanOpen] = useState(false);
  /**
   * The last roll this line was filled from, so the admin can see the cloth left a
   * specific roll rather than an anonymous total. Reset by an undo, since after one
   * that roll holds its cloth again.
   */
  const [rollsCut, setRollsCut] = useState<string[]>([]);

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
  const rollTracked = line.is_roll_tracked === true;

  /** The server's own wording for what it cut, shown under the controls. */
  const recordRolls = (result: PackLineResponse) => {
    setRollsCut(
      (result.rolls ?? [])
        .filter((entry) => !entry.is_reversed)
        .map((entry) => `${entry.roll_number} (${formatMeters(entry.metres)} m)`),
    );
  };

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
      recordRolls(result);
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

  /**
   * Pack this line from a scanned roll label.
   *
   * The label's payload is the roll's primary key, so anything that is not a plain
   * number is some other kind of QR -- a fabric's own code, say -- and is refused
   * here rather than sent on to fail as a lookup for a roll that does not exist.
   */
  const handleScan = async (raw: string) => {
    const roll = Number(raw.trim());
    if (!Number.isInteger(roll) || roll <= 0) {
      toastError(
        "That is not a roll label",
        "Roll labels carry a plain number. Scan the label on the roll itself.",
      );
      return;
    }

    setBusy(true);
    setProblem(null);
    try {
      const result = await packingApi.scanRoll(orderId, line.id, roll);
      setScanOpen(false);
      onPacked(result);
      recordRolls(result);
      toastSuccess(result.message, `${label} · ${formatMeters(result.stock_meters)} m left on the roll`);
    } catch (err) {
      // The scanner stays open on a refusal: the packer most likely just grabbed
      // the wrong roll, and the fix is to scan again rather than reopen anything.
      toastErrorFromError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleUndo = async () => {
    setBusy(true);
    try {
      const result = await packingApi.undoScan(orderId, line.id);
      onPacked(result);
      setRollsCut([]);
      toastSuccess(
        result.message,
        `${label} · ${formatMeters(result.stock_meters)} m left on the roll`,
      );
    } catch (err) {
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

      {rollTracked ? (
        <div className="mt-1.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setScanOpen(true)}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-amber-600 transition-colors disabled:opacity-50"
          >
            {busy ? (
              <span className="w-3 h-3 border-2 border-amber-200 border-t-white rounded-full animate-spin block" />
            ) : (
              <QrCode size={13} />
            )}
            Scan roll to pack
          </button>
          <span className="text-[10px] font-medium text-gray-400">
            Packs the whole scanned roll
          </span>
          <button
            type="button"
            onClick={handleUndo}
            disabled={busy}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-bold text-gray-500 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <Undo2 size={13} />
            Undo last scan
          </button>
        </div>
      ) : (
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

      {rollsCut.length > 0 && (
        <p className="mt-1.5 text-[11px] font-medium text-gray-400">
          Cut from {rollsCut.join(", ")}
        </p>
      )}

      {problem && (
        <p role="alert" className="mt-1.5 text-[11px] font-semibold text-red-600">
          {problem}
        </p>
      )}

      <QRScanModal
        isOpen={scanOpen}
        onClose={() => setScanOpen(false)}
        onScan={handleScan}
      />
    </div>
  );
}
