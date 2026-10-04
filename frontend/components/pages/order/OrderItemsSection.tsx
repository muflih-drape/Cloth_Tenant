"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Scissors } from "lucide-react";
import Link from "next/link";
import { fabricApi } from "@/lib/api/item";
import { applyPackStock, prefillPackMetres } from "@/lib/utils/packLine";
import { useAuth } from "@/context/AuthContext";
import { outstandingMeters } from "@/lib/utils/orderItemSort";
import { OrderItem as OrderItemType, OrderStatus, PackLineResponse } from "@/types/order";
import { formatMeters, toMeters } from "@/types/item";
import OrderItem from "@/components/pages/admin/order-item/OrderItem";
import PackLineRow from "@/components/pages/admin/packing/PackLineRow";
import PackingBundlePanel from "@/components/pages/order/PackingBundlePanel";

interface OrderItemsSectionProps {
  items?: OrderItemType[];
  status?: string;
  orderId?: number;
  onItemsChange: () => void;
  /** Lets the page move its own status badge when a pack fills the order. */
  onOrderStatusChange?: (status: OrderStatus) => void;
}

/**
 * The fabric lines on an order, with a running picture of what the warehouse
 * still owes.
 *
 * Packing normally happens in rounds, which is where a roll is shared out across
 * every order waiting on that colour. An admin can also fill single lines from
 * here, which is the common case when only one order is waiting: one "Update
 * packing" button at the top of the list opens every line for editing at once, and
 * each line packs itself from its own controls inside its own card. It is the same
 * stock movement -- the server writes a one-line packing round for it, so nothing
 * is tracked outside the normal audit trail.
 *
 * The banner that used to sit above the list and point at `/admin/packing` is
 * parked behind a `false` below rather than deleted, in case the round-screen
 * entry point wants bringing back.
 */
export default function OrderItemsSection({
  items,
  status,
  orderId,
  onItemsChange,
  onOrderStatusChange,
}: OrderItemsSectionProps) {
  const { role } = useAuth();
  const isAdmin = role === "ADMIN";

  // Packing is a warehouse action, so it is offered to admins only. The route
  // group is already admin-gated; this keeps the control off the screen if this
  // list is ever reused somewhere an agent can reach.
  const canPack = isAdmin && orderId !== undefined;

  // Packing a line updates it in place rather than refetching the order, so the
  // packed lines are held as a patch over whatever the page last fetched. The
  // patch is dropped as soon as fresh items arrive, since those are at least as
  // current as anything this screen worked out.
  const [patched, setPatched] = useState<Record<number, OrderItemType>>({});
  const [patchedOver, setPatchedOver] = useState(items);
  if (items !== patchedOver) {
    setPatchedOver(items);
    setPatched({});
  }
  const liveItems = (items ?? []).map((line) => patched[line.id] ?? line);

  const [stock, setStock] = useState<Record<number, string>>({});
  // Bumped whenever cloth moves off a roll from the bundle panel, so the stock
  // figures beside each line are re-read rather than drifting behind the scans.
  const [stockRefresh, setStockRefresh] = useState(0);

  // Each line's packing figures are held here, keyed by line, so packing one line
  // leaves the others' typed-in figures alone.
  const [metresDraft, setMetresDraft] = useState<Record<number, string>>({});
  const [justPacked, setJustPacked] = useState<Record<number, boolean>>({});

  const outstanding = liveItems.reduce(
    (sum, i) => sum + toMeters(i.outstanding_quantity),
    0,
  );
  const ordered = liveItems.reduce((sum, i) => sum + toMeters(i.ordered_quantity), 0);
  const allocated = liveItems.reduce(
    (sum, i) => sum + toMeters(i.allocated_quantity),
    0,
  );

  // Lines can only be edited while the order is still open for changes, and
  // never once cloth has moved against them.
  const isEditable = status === "DRAFT" || status === "PENDING" || status === "EDITING";
  const isDeletable = isEditable;
  const awaitingPacking = outstanding > 0 && status !== "DISPATCHED";

  // A line packing has finished belongs with the box that carried it, so the list
  // below carries only what is still owed. That only holds while the bundles are
  // actually on screen to receive those lines: without the panel there would be
  // nowhere for a settled line to be shown, so the list stays whole.
  const bundlesVisible = canPack && orderId !== undefined;
  const outstandingLines = bundlesVisible
    ? liveItems.filter((line) => outstandingMeters(line) > 0)
    : liveItems;

  // Packing is offered while the order is still open for cloth, mirroring the
  // engine's OPEN_STATUSES. There is no cancelled order status to guard against;
  // DISPATCHED is the point of no return, and a DRAFT has no cloth against it yet.
  const canEditPacking =
    canPack && (status === "PENDING" || status === "PACKED");

  // The order page has never carried stock figures, so the roll behind each
  // colour is fetched once here. One request covers every variant on the order.
  useEffect(() => {
    if (!canEditPacking) return;
    let active = true;
    fabricApi
      .getOutstandingDemand()
      .then((rows) => {
        if (!active) return;
        const next: Record<number, string> = {};
        for (const row of rows) {
          next[row.variant] = row.stock_meters;
        }
        setStock(next);
      })
      .catch(() => {
        // Stock figures are an aid here; the endpoint refuses an impossible
        // figure anyway, so a failed lookup just leaves them unknown.
      });
    return () => {
      active = false;
    };
  }, [canEditPacking, stockRefresh]);

  /** What to offer as the starting figure for a line's box. */
  const prefillFor = (line: OrderItemType) => {
    const packed = toMeters(line.allocated_quantity);
    if (packed > 0) return String(packed);
    // Nothing packed yet, so the line still owes its whole ordered amount and
    // the figure is simply what the roll can cover.
    const roll = line.variant === null ? 0 : (stock[line.variant] ?? 0);
    return prefillPackMetres(line.outstanding_quantity, roll);
  };

  const handlePacked = useCallback(
    (result: PackLineResponse) => {
      setPatched((prev) => ({ ...prev, [result.item.id]: result.item }));
      setStock((prev) =>
        applyPackStock(prev, result.item.variant, result.stock_meters),
      );
      // The pack figures stay put, so the admin can carry on with the other lines.
      setJustPacked((prev) => ({ ...prev, [result.item.id]: true }));
      if (result.order_status && result.order_status !== status) {
        onOrderStatusChange?.(result.order_status);
      }
      // The order totals the page keeps -- the header, the "N m packed" footer and
      // the dispatch dialog's ready figure -- are all worked out from the items
      // it last fetched, and a pack moves the roll without changing any of them.
      // Left alone, the page would keep advertising the pre-pack metres beside a
      // line that has just been packed past what it owes. Hand the change up so
      // those figures are the metres actually stored.
      onItemsChange?.();
    },
    [onItemsChange, onOrderStatusChange, status],
  );

  /**
   * Cloth left the shelf through a bundle. The lines and the stock figures on this
   * page both moved, so re-read them rather than leaving the panel's own view of the
   * order as the only current one.
   */
  const handleBundleChanged = useCallback(() => {
    setStockRefresh((n) => n + 1);
    setPatched({});
    onItemsChange?.();
  }, [onItemsChange]);

  return (
    <>
      <div className="mb-4 border-b border-gray-100 pb-2">
        <div>
          <h2 className="text-lg font-extrabold text-gray-900 leading-tight">
            Fabric lines
          </h2>
          <p className="text-xs text-gray-400 font-medium">
            {formatMeters(ordered)} m ordered · {formatMeters(allocated)} m packed
          </p>
        </div>
      </div>

      {false && awaitingPacking && (
        <div className="mb-3 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle size={18} className="shrink-0 text-amber-600" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-amber-900">
              {formatMeters(outstanding)} m still to pack
            </p>
            <p className="text-[11px] text-amber-700">
              Share the roll out in a packing round, or fill a line below.
            </p>
          </div>
          <Link
            href="/admin/packing"
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-[11px] font-bold text-white hover:bg-amber-600 transition-colors"
          >
            <Scissors size={13} />
            Pack
          </Link>
        </div>
      )}

      {canPack && orderId !== undefined && (
        <PackingBundlePanel
          orderId={orderId}
          enabled={canEditPacking}
          items={liveItems}
          onChanged={handleBundleChanged}
          onOrderStatusChange={onOrderStatusChange}
        />
      )}

      <div className="bg-white rounded-2xl overflow-hidden">
        {bundlesVisible && outstandingLines.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs font-medium text-gray-400">
            All items packed — see the bundles above.
          </p>
        ) : (
        <OrderItem
          items={outstandingLines}
          isDeletable={isDeletable}
          isEditable={isEditable}
          orderId={orderId}
          onAllocationChange={onItemsChange}
          onDeleteItem={onItemsChange}
          renderLineFooter={(line) => {
            if (!orderId || !canEditPacking) return null;
            // A line with no colour has no roll to take metres off, so there is
            // nothing to pack for it.
            if (line.variant === null) return null;

            return (
              <PackLineRow
                orderId={orderId}
                line={line}
                stockMeters={stock[line.variant] ?? null}
                metres={metresDraft[line.id] ?? prefillFor(line)}
                onMetresChange={(value) =>
                  setMetresDraft((prev) => ({ ...prev, [line.id]: value }))
                }
                justPacked={justPacked[line.id] === true}
                onPacked={handlePacked}
              />
            );
          }}
        />
        )}
      </div>
    </>
  );
}
