"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Download,
  Lock,
  PackageX,
  Printer,
  QrCode,
  Trash2,
  X,
} from "lucide-react";
import { pdf } from "@react-pdf/renderer";

import QRScanModal from "@/components/items/QRScanModal";
import { BundlePackingSlipPdf } from "@/components/pages/order/BundlePackingSlipPdf";
import { packingApi } from "@/lib/api/order";
import { toastError, toastErrorFromError, toastSuccess } from "@/lib/toast";
import { bundleSlipFilename, parseRollScan } from "@/lib/utils/bundleSlip";
import { formatMeters } from "@/types/item";
import type { OrderStatus, PackingBundle } from "@/types/order";

type Props = {
  orderId: number;
  /** False once the order is out of reach, so no bundle can be opened. */
  enabled: boolean;
  /**
   * Called after anything that moved cloth, so the page can refresh the lines and
   * the stock figures it shows beside them.
   */
  onChanged: () => void;
  /** Lets the page move its own status badge when a scan fills the order. */
  onOrderStatusChange?: (status: OrderStatus) => void;
};

/**
 * Bundles: the boxes of cloth that actually leave the warehouse.
 *
 * A colour with physical rolls cannot be packed by typing a figure -- the roll is
 * the unit, so the packer picks it up and scans the label on it. That scan belongs
 * to a *bundle* rather than to a single order line, because a box can carry rolls of
 * several colours against one order, and because a mistake has to be undoable one
 * roll at a time: take back the wrong roll, leave the rest of the box alone.
 *
 * So the scan lives up here at order level rather than on each line. Nothing else
 * about packing changes: the server builds the same one-entry round it always did
 * and confirms it through the same engine, and the colour on the roll picks which
 * line is filled, so the packer never has to choose a line.
 *
 * The bundle stays *open* until it is sealed. Open means undoable -- remove a roll,
 * or throw the whole bundle away and get every roll back. Sealing is the point of no
 * return, because the packing slip is a promise about what is in the box; after that
 * nothing can go in or come out, and the slip can be printed again as often as it is
 * needed.
 */
export default function PackingBundlePanel({
  orderId,
  enabled,
  onChanged,
  onOrderStatusChange,
}: Props) {
  const [bundles, setBundles] = useState<PackingBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [slipMessage, setSlipMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    packingApi
      .listBundles(orderId)
      .then((rows) => {
        if (live) setBundles(rows);
      })
      .catch(() => {
        // A failed listing is not worth blocking packing over: the admin can carry
        // on and reload. Creating a bundle still works and will show up next load.
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [orderId]);

  /** The bundle being worked on, if one is. */
  const openBundle = bundles.find((bundle) => bundle.status === "OPEN") ?? null;
  const sealedBundles = bundles.filter((bundle) => bundle.status === "SEALED");

  const replaceBundle = (next: PackingBundle) =>
    setBundles((prev) =>
      prev.some((bundle) => bundle.id === next.id)
        ? prev.map((bundle) => (bundle.id === next.id ? next : bundle))
        : [...prev, next],
    );

  /**
   * Render the slip for a bundle and hand the file to the browser.
   *
   * Generated in the browser from data the page already has, so a lost slip is
   * reprinted by pressing the button again rather than by asking the server to
   * remember a file.
   */
  const printSlip = useCallback(
    async (bundle: PackingBundle, download: boolean) => {
      // The inner await matters: `pdf()` hands back a promise, and `toBlob` lives
      // on what it resolves to.
      const blob = await (await pdf(<BundlePackingSlipPdf bundle={bundle} />)).toBlob();
      const url = URL.createObjectURL(blob);
      if (download) {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = bundleSlipFilename(bundle.code);
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
      // Print through a hidden frame so the sheet goes straight to the printer
      // without a second tab the packer has to dismiss.
      const frame = document.createElement("iframe");
      frame.style.display = "none";
      frame.src = url;
      document.body.appendChild(frame);
      frame.onload = () => {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        setTimeout(() => {
          document.body.removeChild(frame);
          URL.revokeObjectURL(url);
        }, 3000);
      };
    },
    [],
  );

  const handleCreate = async () => {
    setBusy(true);
    try {
      const result = await packingApi.createBundle(orderId);
      replaceBundle(result.bundle);
      setSlipMessage(null);
      setScanOpen(true);
      toastSuccess(result.message, "Scan rolls in as you build the box.");
    } catch (err) {
      toastErrorFromError(err);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Cut a scanned roll into the open bundle.
   *
   * The label's payload is the roll's primary key, so anything that is not a plain
   * number is some other kind of QR and is refused here rather than sent on to fail
   * as a lookup for a roll that does not exist. The scanner deliberately stays open
   * after a success: filling a box is a run of scans, not one scan.
   */
  const handleScan = async (raw: string) => {
    const roll = parseRollScan(raw);
    if (roll === null) {
      toastError(
        "That is not a roll label",
        "Roll labels carry a plain number. Scan the label on the roll itself.",
      );
      return;
    }
    if (!openBundle) {
      setScanOpen(false);
      toastError("No open bundle", "Create a bundle before scanning rolls in.");
      return;
    }

    setBusy(true);
    try {
      const result = await packingApi.scanIntoBundle(orderId, openBundle.id, roll);
      replaceBundle(result.bundle);
      onChanged();
      if (result.order_status) onOrderStatusChange?.(result.order_status);
      toastSuccess(
        result.message,
        `${result.fabric_name}${
          result.variant_display_order
            ? ` (${result.variant_display_order})`
            : ""
        } · ${result.bundle.roll_count} roll${
          result.bundle.roll_count === 1 ? "" : "s"
        } in ${result.bundle.code}`,
      );
    } catch (err) {
      // The scanner stays open on a refusal: the packer most likely just grabbed
      // the wrong roll, and the fix is to scan again rather than reopen anything.
      toastErrorFromError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (entryId: number) => {
    if (!openBundle) return;
    setBusy(true);
    try {
      const result = await packingApi.removeRollFromBundle(
        orderId,
        openBundle.id,
        entryId,
      );
      replaceBundle(result.bundle);
      onChanged();
      if (result.order_status) onOrderStatusChange?.(result.order_status);
      toastSuccess(result.message);
    } catch (err) {
      toastErrorFromError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!openBundle) return;
    setBusy(true);
    try {
      const result = await packingApi.cancelBundle(orderId, openBundle.id);
      replaceBundle(result.bundle);
      setConfirmCancel(false);
      setScanOpen(false);
      onChanged();
      if (result.order_status) onOrderStatusChange?.(result.order_status);
      toastSuccess(result.message);
    } catch (err) {
      toastErrorFromError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleSeal = async () => {
    if (!openBundle) return;
    setBusy(true);
    try {
      const result = await packingApi.sealBundle(orderId, openBundle.id);
      replaceBundle(result.bundle);
      setScanOpen(false);
      // Sealing closes the box, so the slip for it is produced straight away
      // rather than left as a job someone has to remember.
      await printSlip(result.bundle, true);
      setSlipMessage(
        `${result.bundle.code} is sealed and its packing slip has been downloaded.`,
      );
      toastSuccess(
        `${result.bundle.code} sealed`,
        "Its contents can no longer be changed.",
      );
    } catch (err) {
      toastErrorFromError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleSlipDownload = async (bundle: PackingBundle) => {
    setBusy(true);
    try {
      await printSlip(bundle, true);
    } catch (err) {
      toastErrorFromError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleSlipPrint = async (bundle: PackingBundle) => {
    setBusy(true);
    try {
      await printSlip(bundle, false);
    } catch (err) {
      toastErrorFromError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-amber-900">
            <Box size={15} />
            Packing bundles
          </h3>
          <p className="mt-0.5 text-[11px] font-medium text-amber-700">
            {openBundle
              ? `${openBundle.code} is open · ${openBundle.roll_count} roll${
                  openBundle.roll_count === 1 ? "" : "s"
                } · ${formatMeters(openBundle.total_metres)} m`
              : sealedBundles.length > 0
                ? `${sealedBundles.length} sealed bundle${
                    sealedBundles.length === 1 ? "" : "s"
                  } on this order`
                : "Scan whole rolls into a box, then seal it to print its packing slip."}
          </p>
        </div>

        {enabled && !openBundle && (
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy || loading}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-[11px] font-bold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
          >
            <QrCode size={13} />
            Create bundle
          </button>
        )}

        {openBundle && (
          <button
            type="button"
            onClick={() => setScanOpen(true)}
            disabled={busy}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-[11px] font-bold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
          >
            <QrCode size={13} />
            Scan a roll into this bundle
          </button>
        )}
      </div>

      {slipMessage && (
        <p className="mt-2 text-[11px] font-semibold text-green-700">
          {slipMessage}
        </p>
      )}

      {openBundle && (
        <div className="mt-3">
          {openBundle.rolls.length === 0 ? (
            <p className="text-[11px] font-medium text-amber-700">
              Nothing in this bundle yet. Scan a roll label to put one in.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {openBundle.rolls.map((roll) => (
                <li
                  key={roll.id}
                  className="flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2"
                >
                  <span className="w-20 shrink-0 font-mono text-[11px] font-bold text-gray-900">
                    {roll.roll_number}
                  </span>
                  <span className="min-w-0 flex-1 text-[11px] font-medium text-gray-600">
                    {roll.fabric_name || roll.fabric}
                    {roll.colour ? ` · ${roll.colour}` : ""} ·{" "}
                    {formatMeters(roll.metres)} m
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemove(roll.id)}
                    disabled={busy}
                    className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[10px] font-bold text-gray-500 transition-colors hover:bg-gray-50 hover:text-red-600 disabled:opacity-50"
                  >
                    <Trash2 size={11} />
                    Remove from bundle
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSeal}
              disabled={busy || openBundle.rolls.length === 0}
              title={
                openBundle.rolls.length === 0
                  ? "A bundle has to hold at least one roll before it can be sealed."
                  : undefined
              }
              className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-gray-700 disabled:opacity-50"
            >
              <Lock size={13} />
              Complete bundle &amp; print slip
            </button>

            {confirmCancel ? (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={busy}
                  className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  <PackageX size={13} />
                  Give every roll back
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmCancel(false)}
                  className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-bold text-gray-500 transition-colors hover:bg-gray-50"
                >
                  <X size={13} />
                  Keep bundle
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmCancel(true)}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-bold text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                <PackageX size={13} />
                Cancel bundle
              </button>
            )}
          </div>

          {confirmCancel && (
            <p className="mt-2 text-[11px] font-medium text-red-600">
              Cancelling puts every roll in this bundle back on the shelf and takes
              the metres off the order. The bundle is kept as a record.
            </p>
          )}
        </div>
      )}

      {sealedBundles.length > 0 && (
        <div className="mt-3 border-t border-amber-200 pt-3">
          <p className="text-[11px] font-bold text-amber-900">
            Sealed bundles
          </p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {sealedBundles.map((bundle) => (
              <li
                key={bundle.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2"
              >
                <span className="text-[11px] font-bold text-gray-900">
                  {bundle.code}
                </span>
                <span className="text-[11px] font-medium text-gray-500">
                  {bundle.roll_count} roll{bundle.roll_count === 1 ? "" : "s"} ·{" "}
                  {formatMeters(bundle.total_metres)} m ·{" "}
                  {bundle.sealed_at ? bundle.sealed_at.slice(0, 10) : "sealed"}
                </span>
                <span className="ml-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleSlipPrint(bundle)}
                    disabled={busy}
                    className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[10px] font-bold text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-50"
                  >
                    <Printer size={11} />
                    Print slip
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSlipDownload(bundle)}
                    disabled={busy}
                    className="flex items-center gap-1 rounded-lg bg-gray-900 px-2 py-1 text-[10px] font-bold text-white transition-colors hover:bg-gray-700 disabled:opacity-50"
                  >
                    <Download size={11} />
                    Download slip
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <QRScanModal
        isOpen={scanOpen}
        onClose={() => setScanOpen(false)}
        onScan={handleScan}
      />
    </section>
  );
}