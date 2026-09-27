"use client";
import OrderItem from "@/components/pages/admin/order-item/OrderItem";
import { customerApi } from "@/lib/api/customer";
import { transportApi } from "@/lib/api/transport";
import { toastError, toastSuccess } from "@/lib/toast";
import { CustomerResponse } from "@/types/customer";
import {
  ChevronLeft,
  Plus,
  User,
  ShoppingBag,
  AlertTriangle,
  X,
  MapPin,
  Package,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { orderApi } from "@/lib/api/order";
import { OrderResponse, PlaceOrderResponse, PlaceOrderShortfall } from "@/types/order";
import { formatMeters, toMeters } from "@/types/item";
import { PageLoading } from "@/components/ui/Loading";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import { AxiosError } from "axios";
import { OrderTotals } from "@/components/order";
import PriceOverrideDialog from "@/components/order/PriceOverrideDialog";
import { useBackButton } from "@/util/useBackButton";
import { Modal, ModalButton } from "@/components/ui/custom/Modals";
import { useOrderFlow } from "@/context/OrderFlowContext";
import { persistDraftOrderId, readDraftOrderId } from "@/lib/draftOrder";
import { extractErrorMessage } from "@/lib/orderFlow";

type LoadError = { kind: "notfound" | "error"; message?: string };

export default function OrderDetailsPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const { basePath, isAdmin, afterPlacePath } = useOrderFlow();

  const [data, setData] = useState<CustomerResponse>();
  const [loading, setLoading] = useState(true);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [orders, setOrders] = useState<OrderResponse>();
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Placing an order records demand; it never fails for want of cloth. Oversubscribed
  // lines come back as a report, and packing decides who gets what.
  const [showShortfallModal, setShowShortfallModal] = useState(false);
  const [shortfallLines, setShortfallLines] = useState<PlaceOrderShortfall[]>([]);
  const [shortfallNotice, setShortfallNotice] = useState<string | null>(null);
  const [showMergeWarning, setShowMergeWarning] = useState(false);
  const [showPriceDialog, setShowPriceDialog] = useState(false);
  const [savingTotal, setSavingTotal] = useState(false);
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState<string>("");
  const [preferredTransportID, setPreferredTransportID] = useState<
    number | null
  >(null);
  const [transports, setTransports] = useState<
    { value: number; label: string }[]
  >([]);
  const [loadingTransports, setLoadingTransports] = useState(true);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [notes, setNotes] = useState<string>("");

  useBackButton({
    onBack: useCallback(() => {
      setShowLeaveConfirm(true);
    }, []),
  });

  const isReady = useRef(false);

  // The order this screen is working on, already validated against the customer
  // in the route. Everything below addresses the order through this rather than
  // re-reading storage, which can be repointed between render and click.
  const activeOrderId = orders?.id ?? null;

  useEffect(() => {
    if (!isReady.current) return; // skip until data is loaded
    if (activeOrderId === null) return;

    const timer = setTimeout(() => {
      orderApi
        .update(activeOrderId, {
          expected_delivery_date: expectedDeliveryDate || null,
          preferred_transport: preferredTransportID || null,
          notes: notes || null,
        })
        .catch(console.error);
    }, 600);

    return () => clearTimeout(timer);
  }, [expectedDeliveryDate, preferredTransportID, notes, activeOrderId]);

  interface MergeGroup {
    fabric_name: string;
    variant_display_order: string;
    items: Array<{ id: number; metres: number }>;
    totalMetres: number;
  }

  /** The same colour scanned twice is really one line; the totals get combined. */
  const duplicateGroups = (() => {
    if (!orders?.items.length) return [];
    const map = new Map<
      string,
      { id: number; metres: number; fabric_name: string; variant_display_order: string }[]
    >();
    for (const item of orders.items) {
      const key = `${item.fabric ?? "unknown"}-${item.variant ?? "none"}`;
      const group = map.get(key) ?? [];
      group.push({
        id: item.id,
        metres: toMeters(item.ordered_quantity),
        fabric_name: item.fabric_name,
        variant_display_order: item.variant_display_order,
      });
      map.set(key, group);
    }
    const groups: MergeGroup[] = [];
    for (const [, items] of map) {
      if (items.length > 1) {
        groups.push({
          fabric_name: items[0].fabric_name,
          variant_display_order: items[0].variant_display_order,
          items: items.map((i) => ({ id: i.id, metres: i.metres })),
          totalMetres: items.reduce((sum, i) => sum + i.metres, 0),
        });
      }
    }
    return groups;
  })();

  const totalMetres =
    orders?.items.reduce((sum, item) => sum + toMeters(item.ordered_quantity), 0) ?? 0;
  // Bill what the order is actually worth, which is the agreed total once one
  // is set, not the raw line arithmetic.
  const totalMoney = Number(orders?.totals.effective_total ?? 0);
  const computedTotal = Number(orders?.totals.computed_total ?? 0);
  const isPriceOverridden = orders?.totals.is_price_overridden ?? false;
  // The total may only be set while the order is still a draft, and only while
  // there is something to bill -- an empty order has nothing to discount.
  const canSetTotal = orders?.status === "DRAFT" && totalMetres > 0;

  /**
   * Agree a total with the customer before the order is placed. The server caps
   * an agent at the line arithmetic; this only relays the number and refetches
   * so the summary reflects what was actually saved.
   */
  const handleSaveTotal = async (total: number, reason: string) => {
    if (activeOrderId === null) return;

    setSavingTotal(true);
    try {
      await orderApi.setPrice(activeOrderId, {
        final_total: total.toFixed(2),
        ...(reason ? { reason } : {}),
      });
      setShowPriceDialog(false);
      setOrders(await orderApi.getOne(activeOrderId));
      toastSuccess(
        Math.abs(total - computedTotal) < 0.005
          ? "Order total reset"
          : "Order total updated",
      );
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string; detail?: string }>;
      toastError(
        extractErrorMessage(
          axiosError.response?.data,
          "Could not update the order total",
        ),
      );
    } finally {
      setSavingTotal(false);
    }
  };

  const handlePlaceOrder = async () => {
    if (activeOrderId === null) return;
    if (duplicateGroups.length > 0) {
      setShowMergeWarning(true);
      return;
    }
    setPlacingOrder(true);
    try {
      const result = await orderApi.placeOrder(activeOrderId, {
        expected_delivery_date: expectedDeliveryDate || null,
        preferred_transport: preferredTransportID || null,
        notes: notes || null,
      });
      // The order is placed either way. Oversubscription is a packing decision,
      // so say so plainly and send the agent to the order.
      if (result.shortfall_lines?.length) {
        setShortfallLines(result.shortfall_lines);
        setShortfallNotice(result.notice);
        setShowShortfallModal(true);
        return;
      }
      toastSuccess("Order placed successfully!");
      router.push(afterPlacePath(activeOrderId));
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string; detail?: string }>;
      toastError(
        axiosError.response?.data?.error ||
          axiosError.response?.data?.detail ||
          "Failed to place order",
      );
    } finally {
      setPlacingOrder(false);
    }
  };

  const handleProceedWithPlaceOrder = async () => {
    setShowMergeWarning(false);
    if (activeOrderId === null) return;
    setPlacingOrder(true);
    try {
      // Fold each duplicate set into one line. The server sums the metres in
      // Decimal and does the whole group in a single transaction -- summing in
      // JS gives values like 0.30000000000000004 that the serializer rejects,
      // and a failure halfway through a per-line loop leaves the order billing
      // for metres twice.
      for (const group of duplicateGroups) {
        await orderApi.mergeItems(activeOrderId, {
          keep_item_id: group.items[0].id,
          drop_item_ids: group.items.slice(1).map((i) => i.id),
        });
      }
      const res = await orderApi.getOne(activeOrderId);
      setOrders(res);
      const result: PlaceOrderResponse = await orderApi.placeOrder(
        activeOrderId,
        {
          expected_delivery_date: expectedDeliveryDate || null,
          preferred_transport: preferredTransportID || null,
          notes: notes || null,
        },
      );
      if (result.shortfall_lines?.length) {
        setShortfallLines(result.shortfall_lines);
        setShortfallNotice(result.notice);
        setShowShortfallModal(true);
        return;
      }
      toastSuccess("Order placed successfully!");
      router.push(afterPlacePath(activeOrderId));
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string; detail?: string }>;
      toastError(
        axiosError.response?.data?.error ||
          axiosError.response?.data?.detail ||
          "Failed to place order",
      );
    } finally {
      setPlacingOrder(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    // Drop the previous order before fetching. Without this, `orders` keeps the
    // last order's value for the whole fetch, so any non-happy path renders
    // another customer's lines.
    setOrders(undefined);
    isReady.current = false;
    const fetchData = async () => {
      try {
        const numericId = parseInt(id, 10);
        const response = await customerApi.getOne(numericId);
        setData(response);
        const orderId = readDraftOrderId();
        if (orderId) {
          const res2 = await orderApi.getOne(orderId);
          // The route names the customer; storage names the order. If they
          // disagree the stored order belongs to somebody else, so refuse it
          // rather than editing (or emptying) it. See createDraftOrder.
          //
          // `customer` is write-only on the serializer, so it never comes back
          // in a response -- the owning customer only arrives nested as
          // customer_details. Reading res2.customer here would be undefined
          // and refuse every legitimate draft.
          if (res2.customer_details?.id !== numericId) {
            persistDraftOrderId(null);
            setLoadError({ kind: "notfound" });
            return;
          }
          setOrders(res2);
          setPreferredTransportID(
            res2.preferred_transport || response.preferred_transport,
          );
          setExpectedDeliveryDate(res2.expected_delivery_date || "");
          setNotes(res2.notes || "");
          isReady.current = true;
        } else {
          // No draft in storage at all, so there is nothing to edit. Say so
          // rather than rendering an empty order whose every save would fail.
          setLoadError({ kind: "notfound" });
        }
      } catch (e) {
        console.error("Error fetching order details:", e);
        const axiosError = e as AxiosError<{ error?: string; detail?: string }>;
        const status = axiosError.response?.status;
        console.error("Order details load failed:", status ?? "network error");
        if (status === 404) {
          // A reaped or removed draft leaves a dead id in storage, which would
          // make this page fail forever. Clear it so picking a customer again
          // starts from a clean slate.
          persistDraftOrderId(null);
          setLoadError({ kind: "notfound" });
        } else {
          setLoadError({
            kind: "error",
            message: extractErrorMessage(
              axiosError.response?.data,
              "Something went wrong",
            ),
          });
        }
      } finally {
        setLoading(false);
      }
    };

    const fetchTransports = async () => {
      setLoadingTransports(true);
      try {
        const response = await transportApi.getActive();
        const formattedTransports = response.map((transport) => ({
          value: transport.id,
          label: transport.name,
        }));
        setTransports(formattedTransports);
      } catch (error) {
        console.error("Error fetching transports:", error);
      } finally {
        setLoadingTransports(false);
      }
    };

    fetchData();
    fetchTransports();
  }, [id, isAdmin, reloadKey]);

  const handleDeleteItem = (itemId: number) => {
    setOrders((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.filter((item) => item.id !== itemId),
      };
    });
  };

  useEffect(() => {
    if (loadError && !isAdmin) {
      // Both roles now get the recovery screen below, so this banner is a
      // nudge only -- do not bounce the agent off a page they can act on.
      toastError("That order is no longer available.");
    }
  }, [loadError, isAdmin, router, basePath]);

  if (loading) return <PageLoading />;

  if (loadError) {
    const isNotFound = loadError.kind === "notfound";
    // An agent has no customer picker to hand, so their way back is the customer
    // list rather than a prefilled screen.
    const startOverPath = isAdmin
      ? `/admin/order/new?customer=${id}`
      : `${basePath}`;
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={26} className="text-amber-500" />
          </div>
          <h1 className="text-lg font-black text-gray-900">
            {isNotFound ? "Order unavailable" : "Something went wrong"}
          </h1>
          <p className="text-sm text-gray-500 mt-2 mb-6">
            {isNotFound
              ? "This order draft has expired or was removed. You can start a new order for this customer."
              : loadError.message}
          </p>
          {isNotFound ? (
            <StockFlowButton
              text="Start new order"
              variant="filled"
              onClick={() => router.push(startOverPath)}
              className="w-full h-12 rounded-2xl"
            />
          ) : (
            <StockFlowButton
              text="Retry"
              variant="filled"
              onClick={() => {
                setLoadError(null);
                setReloadKey((k) => k + 1);
              }}
              className="w-full h-12 rounded-2xl"
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-36">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-20">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => setShowLeaveConfirm(true)}
            className="p-2 -ml-1 rounded-xl hover:bg-gray-50 text-gray-400 transition-colors"
          >
            <ChevronLeft size={22} />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-black text-gray-900 leading-none">
              Order Details
            </h1>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">
              Step 2 — Add Fabrics
            </p>
          </div>
          {/* Item count pill in header */}
          {orders && orders.items.length > 0 && (
            <div className="flex items-center gap-1.5 bg-primary/8 border border-primary/15 rounded-full px-3 py-1">
              <Package size={12} className="text-primary" />
              <span className="text-xs font-black text-primary">
                {orders.items.length}
              </span>
            </div>
          )}
        </div>
      </div>

      {isAdmin && (
        <div className="bg-primary/5 border-b border-primary/10 px-4 py-2">
          <div className="max-w-lg mx-auto flex items-center justify-between gap-3 text-[11px]">
            <span className="font-bold text-gray-700 truncate">
              Order for {data?.name ?? "—"}
            </span>
            <span className="text-gray-400 font-medium shrink-0">
              Agent: {data?.agent_name || "—"}
            </span>
          </div>
        </div>
      )}

      <div className="max-w-lg mx-auto px-4 pt-6 space-y-6">
        {/* Customer Card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="items-center gap-4 p-4">
            <div className="flex pb-4 items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <User size={20} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 leading-none mb-1">
                  Customer
                </p>
                <h3 className="text-base font-black text-gray-900 truncate">
                  {data?.name}
                </h3>
              </div>
            </div>
            {data?.address && (
              <div className="flex items-start gap-2 px-4 py-2.5 bg-gray-50 border-t border-gray-100">
                <MapPin
                  size={12}
                  className="text-gray-400 mt-0.5 flex-shrink-0"
                />
                <p className="text-xs text-gray-500 leading-relaxed">
                  {data.address}
                </p>
              </div>
            )}
          </div>

          <div className="bg-white border-t border-gray-100 p-4 space-y-4">
            <h3 className="text-sm font-bold text-gray-900">
              Delivery Options
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[8px] md:text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5 block">
                  Expected Delivery Date
                </label>
                <div className="relative">
                  <input
                    type="date"
                    value={expectedDeliveryDate}
                    onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                    min={new Date().toISOString().split("T")[0]}
                    className="w-full px-2 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:border-primary focus:ring-2 focus:ring-primary/10 text-sm"
                  />
                </div>
                <p className="text-[8px] text-gray-400 mt-1">
                  Leave empty for &quot;Whenever&quot;
                </p>
              </div>

              <div>
                <label className="text-[8px] md:text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5 block">
                  Preferred Transport
                </label>
                <select
                  value={preferredTransportID || ""}
                  onChange={(e) =>
                    setPreferredTransportID(Number(e.target.value))
                  }
                  disabled={loadingTransports}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:border-primary focus:ring-2 focus:ring-primary/10 text-sm appearance-none"
                >
                  <option value="">None</option>
                  {transports.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-[8px] md:text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5 block">
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any special instructions or remarks..."
                rows={3}
                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-100 rounded-xl focus:border-primary focus:ring-2 focus:ring-primary/10 text-sm resize-none"
              />
            </div>
          </div>
        </div>

        {/* Items Section */}
        <div>
          {/* Section header */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-black text-gray-900">
                Fabric Lines
              </h2>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-0.5">
                {orders?.items.length
                  ? `${orders.items.length} line${orders.items.length !== 1 ? "s" : ""} · ${formatMeters(totalMetres)} m`
                  : "No fabrics yet"}
              </p>
            </div>
            <StockFlowButton
              text="Add Fabric"
              variant="filled"
              icon={<Plus className="size-4" />}
              onClick={() => router.push(`${basePath}/${id}/scanner`)}
              className="shadow-md shadow-primary/20 active:scale-95 transition-all text-sm h-10 px-4 rounded-xl"
            />
          </div>

          {/* Empty state */}
          {!orders || orders.items.length === 0 ? (
            <div
              onClick={() => router.push(`${basePath}/${id}/scanner`)}
              className="flex flex-col items-center justify-center py-14 bg-white rounded-2xl border-2 border-dashed border-gray-200 cursor-pointer hover:border-primary/30 hover:bg-primary/2 transition-all group"
            >
              <div className="w-14 h-14 rounded-2xl bg-gray-100 group-hover:bg-primary/10 flex items-center justify-center mb-3 transition-colors">
                <ShoppingBag
                  size={26}
                  className="text-gray-300 group-hover:text-primary transition-colors"
                />
              </div>
              <p className="text-gray-500 text-sm font-bold">
                No fabrics added yet
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Tap to scan or search fabrics
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <OrderItem
                orderId={orders.id}
                items={orders.items}
                isDeletable={true}
                isEditable={true}
                onDeleteItem={handleDeleteItem}
              />
            </div>
          )}
        </div>

        {/* Order Totals */}
        {orders && orders.items.length > 0 && (
          <OrderTotals
            totalMetres={totalMetres}
            totalLines={orders.items.length}
            totalPrice={totalMoney}
            onPlaceOrder={handlePlaceOrder}
            isLoading={placingOrder}
            buttonText="Place Order"
            computedTotal={computedTotal}
            isPriceOverridden={isPriceOverridden}
            onEditTotal={canSetTotal ? () => setShowPriceDialog(true) : undefined}
          />
        )}
      </div>

      {/* ── Modals ── */}

      {/* Agreed total -- only reachable while the order is still a draft */}
      {showPriceDialog && (
        <PriceOverrideDialog
          computedTotal={computedTotal}
          currentTotal={totalMoney}
          isOverridden={isPriceOverridden}
          canRaise={isAdmin}
          isSaving={savingTotal}
          onSave={handleSaveTotal}
          onClose={() => setShowPriceDialog(false)}
        />
      )}

      {/* Shortfall report -- the order is placed, packing decides the split */}
      {showShortfallModal && (
        <Modal
          icon={<AlertTriangle size={18} className="text-amber-500" />}
          iconBg="bg-amber-100"
          title="Order placed"
          description={
            shortfallNotice ??
            "Some of this order asks for more cloth than we hold. Packing will allocate what is available."
          }
          onClose={() => {
            setShowShortfallModal(false);
            if (activeOrderId !== null) router.push(afterPlacePath(activeOrderId));
          }}
          actions={
            <>
              <ModalButton
                variant="ghost"
                onClick={() => {
                  setShowShortfallModal(false);
                  if (activeOrderId !== null) router.push(afterPlacePath(activeOrderId));
                }}
              >
                View order
              </ModalButton>
              <ModalButton
                variant="primary"
                onClick={() => {
                  setShowShortfallModal(false);
                  if (activeOrderId !== null) router.push(afterPlacePath(activeOrderId));
                }}
              >
                Got it
              </ModalButton>
            </>
          }
        >
          <div className="space-y-2">
            {shortfallLines.map((line) => (
              <div
                key={line.order_item_id}
                className="bg-amber-50 rounded-xl p-3 border border-amber-100"
              >
                <p className="font-bold text-gray-900 text-sm">
                  {line.fabric_name}
                </p>
                {line.variant_display_order && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {line.variant_display_order}
                  </p>
                )}
                <div className="flex gap-4 mt-2 text-xs text-gray-500 flex-wrap">
                  <span>
                    You asked:{" "}
                    <span className="font-bold text-gray-800">
                      {formatMeters(line.required)} m
                    </span>
                  </span>
                  <span>
                    Everyone wants:{" "}
                    <span className="font-bold text-gray-800">
                      {formatMeters(line.total_demand)} m
                    </span>
                  </span>
                  <span>
                    We hold:{" "}
                    <span className="font-bold text-amber-700">
                      {formatMeters(line.available)} m
                    </span>
                  </span>
                  <span>
                    Short by:{" "}
                    <span className="font-bold text-red-600">
                      {formatMeters(line.shortfall)} m
                    </span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* Merge Warning Modal */}
      {showMergeWarning && (
        <Modal
          icon={<AlertTriangle size={18} className="text-amber-500" />}
          iconBg="bg-amber-100"
          title="Duplicate Fabrics"
          description="The same colour was scanned more than once. They'll be combined into one line with the total metres."
          onClose={() => setShowMergeWarning(false)}
          actions={
            <>
              <ModalButton
                variant="ghost"
                onClick={() => setShowMergeWarning(false)}
              >
                Cancel
              </ModalButton>
              <ModalButton
                variant="primary"
                onClick={handleProceedWithPlaceOrder}
                disabled={placingOrder}
              >
                {placingOrder ? "Merging…" : "Proceed"}
              </ModalButton>
            </>
          }
        >
          {duplicateGroups.map((group, idx) => (
            <div
              key={idx}
              className="bg-amber-50 rounded-xl p-3 border border-amber-100"
            >
              <p className="font-bold text-gray-900 text-sm">
                {group.fabric_name}
              </p>
              {group.variant_display_order && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {group.variant_display_order}
                </p>
              )}
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {group.items.map((item, i) => (
                  <span key={item.id} className="flex items-center gap-1.5">
                    <span className="text-xs font-bold bg-white border border-amber-200 text-amber-700 rounded-lg px-2 py-0.5">
                      {formatMeters(item.metres)} m
                    </span>
                    {i < group.items.length - 1 && (
                      <span className="text-gray-400 text-xs">+</span>
                    )}
                  </span>
                ))}
                <span className="text-gray-400 text-xs mx-0.5">=</span>
                <span className="text-xs font-black text-amber-600 bg-amber-100 border border-amber-200 rounded-lg px-2 py-0.5">
                  {formatMeters(group.totalMetres)} m
                </span>
              </div>
            </div>
          ))}
        </Modal>
      )}

      {/* Leave Confirmation Modal */}
      {showLeaveConfirm && (
        <Modal
          icon={<AlertTriangle size={18} className="text-amber-500" />}
          iconBg="bg-amber-100"
          title="Leave Order?"
          description="Your current order progress may be lost if you go back."
          onClose={() => setShowLeaveConfirm(false)}
          actions={
            <>
              <ModalButton
                variant="ghost"
                onClick={() => setShowLeaveConfirm(false)}
              >
                Stay
              </ModalButton>

              <ModalButton
                variant="primary"
                onClick={() => {
                  setShowLeaveConfirm(false);
                  router.push(basePath);
                }}
              >
                Leave
              </ModalButton>
            </>
          }
        >
          <div className="bg-amber-50 rounded-xl p-3 border border-amber-100">
            <p className="text-sm text-amber-800 font-medium">
              Are you sure you want to leave this page?
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
