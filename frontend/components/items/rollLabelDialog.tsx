"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { Printer, X } from "lucide-react";
import { formatMeters, toMeters } from "@/types/item";
import type { FabricRoll } from "@/types/item";

interface Props {
  roll: FabricRoll;
  fabric: string;
  displayOrder: string;
  /** The fabric's catalogue rate, which the roll's value is worked out from. */
  pricePerMeter: string;
  onClose: () => void;
}

/**
 * The label that goes on one physical roll.
 *
 * A roll is not split at the warehouse, so the label is what tells the packer what
 * they picked up: which colour, how much is on it, and what it is worth. The QR
 * carries the roll's primary key, which is the whole point of it -- scanning this
 * label against an order line fills that line from this exact roll, and the server
 * refuses the scan if the colour or the line does not match.
 *
 * This is deliberately a plain HTML label printed by the browser rather than a PDF.
 * The roll sheet is a physical object stuck to cloth: the print dialog is where
 * the packer already is, it works the same on the warehouse phone, and a generated
 * PDF would add a second renderer to keep in step with no gain on a label this
 * plain. The variant QR sheets are a separate screen and are left alone.
 */
export default function RollLabelDialog({
  roll,
  fabric,
  displayOrder,
  pricePerMeter,
  onClose,
}: Props) {
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The label's payload is the roll's primary key, so a scan resolves to exactly
    // one roll rather than to a colour that may have several lengths on the shelf.
    QRCode.toDataURL(String(roll.id), { width: 320, margin: 1 }).then((url) => {
      if (!cancelled) setQr(url);
    });
    return () => {
      cancelled = true;
    };
  }, [roll.id]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4 py-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-3xl bg-white shadow-2xl overflow-hidden print:shadow-none">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 print:hidden">
          <h2 className="text-sm font-black text-gray-900">{roll.roll_number} label</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
            aria-label="Close roll label"
          >
            <X size={18} />
          </button>
        </div>

        <RollLabel
          roll={roll}
          fabric={fabric}
          displayOrder={displayOrder}
          pricePerMeter={pricePerMeter}
          qr={qr}
        />

        <div className="flex gap-2 px-5 pb-5 print:hidden">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-2xl border-2 border-gray-200 text-sm font-bold text-gray-500 hover:bg-gray-50 transition-all active:scale-95"
          >
            Close
          </button>
          <button
            type="button"
            onClick={print}
            disabled={qr === null}
            className="h-11 flex-1 rounded-2xl bg-primary text-white text-sm font-bold flex items-center justify-center gap-1.5 shadow-lg shadow-primary/20 disabled:opacity-50 transition-all active:scale-95"
          >
            <Printer size={16} />
            Print label
          </button>
        </div>
      </div>
    </div>
  );
}

interface LabelProps {
  roll: FabricRoll;
  fabric: string;
  displayOrder: string;
  pricePerMeter: string;
  /** The roll's QR as a data URL, or null while it is still being encoded. */
  qr: string | null;
}

/**
 * One roll's label, and nothing else: no dialog, no buttons, no print call.
 *
 * Split out of {@link RollLabelDialog} so that printing a whole colour's rolls at
 * once is this component repeated rather than a second label design that drifts
 * from the first. It is markup only -- the caller decides how the codes are made
 * and when the printer is sent.
 */
export function RollLabel({
  roll,
  fabric,
  displayOrder,
  pricePerMeter,
  qr,
}: LabelProps) {
  // Priced on the roll's received length, which is the cloth this roll is worth
  // however much of it has since been cut for orders.
  const rate = toMeters(pricePerMeter);
  const value = rate * toMeters(roll.original_meters);

  return (
    /*
      The label itself. `print:` utilities strip the app chrome away, and the
      fixed width and generous type are what make it legible from a metre away
      once it is stuck to a roll.
    */
    <div className="mx-5 mb-5 rounded-2xl border-2 border-gray-900 p-5 text-center print:mx-0 print:mb-0 print:rounded-none print:p-0">
      <p className="text-xl font-black leading-tight text-gray-900">{fabric}</p>
      <p className="mt-1 text-lg font-bold text-gray-700">
        {displayOrder ? `Color #${displayOrder}` : "Colour not named"}
      </p>

      {qr ? (
        <Image
          src={qr}
          unoptimized
          alt={`QR code for roll ${roll.roll_number}`}
          width={160}
          height={160}
          className="mx-auto my-4 h-40 w-40 print:my-3 print:h-36 print:w-36"
        />
      ) : (
        <div className="mx-auto my-4 h-40 w-40 animate-pulse bg-gray-100 print:hidden" />
      )}

      <p className="text-2xl font-black tracking-wide text-gray-900">
        {roll.roll_number}
      </p>
      <p className="mt-1.5 text-lg font-bold text-gray-800">
        {formatMeters(roll.original_meters)} m
      </p>
      <p className="text-[11px] font-medium uppercase tracking-widest text-gray-400">
        on the roll
      </p>
      <p className="mt-3 text-lg font-black text-gray-900">
        Rs. {value.toFixed(2)}
      </p>
      <p className="text-[11px] font-medium text-gray-400">
        {`Rs. ${rate.toFixed(2)}/m × ${formatMeters(roll.original_meters)} m`}
      </p>
    </div>
  );
}

/**
 * Every roll of one colour's labels in a single print job.
 *
 * The warehouse labels a batch of rolls as it shelves them, so the whole colour is
 * printed in one go from the Inventory page. The labels are the same ones, in the
 * same order, from the same {@link RollLabel}: this only differs in looping.
 *
 * A roll with nothing left on it is left out. A label is scanned to pick that
 * exact roll into a packing round, and a roll that has been cut to zero cannot be
 * picked, so its label would be printed only to be binned.
 */
export function RollLabelsDialog({
  rolls,
  fabric,
  displayOrder,
  pricePerMeter,
  onClose,
}: Omit<LabelProps, "qr" | "roll"> & {
  rolls: FabricRoll[];
  onClose: () => void;
}) {
  const [qrs, setQrs] = useState<Record<number, string>>({});

  useEffect(() => {
    let cancelled = false;
    // One encoding per roll, keyed by primary key so a repeated code cannot be
    // filed under the wrong roll.
    Promise.all(
      rolls.map((roll) =>
        QRCode.toDataURL(String(roll.id), { width: 320, margin: 1 }).then(
          (url) => [roll.id, url] as const,
        ),
      ),
    )
      .then((pairs) => {
        if (!cancelled) setQrs(Object.fromEntries(pairs));
      })
      .catch(() => {
        // Printing early would put a blank square on cloth, so the button stays
        // disabled instead.
        if (!cancelled) setQrs({});
      });
    return () => {
      cancelled = true;
    };
  }, [rolls]);

  // Not until every code is drawn: a half-printed sheet of labels is worse than
  // a moment's wait.
  const ready = rolls.every((roll) => qrs[roll.id] !== undefined);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm px-4 py-8 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-3xl bg-white shadow-2xl overflow-hidden print:shadow-none">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 print:hidden">
          <h2 className="text-sm font-black text-gray-900">
            {rolls.length} roll label{rolls.length === 1 ? "" : "s"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
            aria-label="Close roll labels"
          >
            <X size={18} />
          </button>
        </div>

        {rolls.map((roll) => (
          <RollLabel
            key={roll.id}
            roll={roll}
            fabric={fabric}
            displayOrder={displayOrder}
            pricePerMeter={pricePerMeter}
            qr={qrs[roll.id] ?? null}
          />
        ))}

        <div className="flex gap-2 px-5 pb-5 print:hidden">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-2xl border-2 border-gray-200 text-sm font-bold text-gray-500 hover:bg-gray-50 transition-all active:scale-95"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!ready}
            className="h-11 flex-1 rounded-2xl bg-primary text-white text-sm font-bold flex items-center justify-center gap-1.5 shadow-lg shadow-primary/20 disabled:opacity-50 transition-all active:scale-95"
          >
            <Printer size={16} />
            Print {rolls.length} label{rolls.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
