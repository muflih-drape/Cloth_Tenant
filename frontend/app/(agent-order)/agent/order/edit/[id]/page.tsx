"use client";
import OrderItem from "@/components/pages/admin/order-item/OrderItem";
import { toastError, toastSuccess } from "@/lib/toast";
import {
  ChevronLeft,
  Plus,
  ShoppingBag,
  AlertTriangle,
  X,
  Package,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { orderApi } from "@/lib/api/order";
import { OrderResponse } from "@/types/order";
import { formatMeters, toMeters } from "@/types/item";
import { PageLoading } from "@/components/ui/Loading";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import { AxiosError } from "axios";
import { OrderTotals } from "@/components/order";
import { useEditGuard } from "@/lib/useEditGuard";
import { transportApi } from "@/lib/api/transport";

export default function EditOrderPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const { handleBack } = useEditGuard(id);

  const [loading, setLoading] = useState(true);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [orders, setOrders] = useState<OrderResponse>();
  const [loadError, setLoadError] = useState(false);
  const [showMergeWarning, setShowMergeWarning] = useState(false);

  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [preferredTransport, setPreferredTransport] = useState("");

  const [transports, setTransports] = useState<
    { value: string; label: string }[]
  >([]);

  const [loadingTransports, setLoadingTransports] = useState(true);
  const [notes, setNotes] = useState("");
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
  const totalMoney = Number(orders?.totals.computed_total ?? 0);

  const handleSaveChanges = async () => {
    if (duplicateGroups.length > 0) {
      setShowMergeWarning(true);
      return;
    }

    setPlacingOrder(true);
    try {
      await orderApi.saveEdit(Number(id), {
        expected_delivery_date: expectedDeliveryDate || null,
        preferred_transport: preferredTransport
          ? parseInt(preferredTransport)
          : null,
        notes: notes || null,
      });
      toastSuccess("Order saved successfully!");
      router.push(`/agent/order/status/${id}`);
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string; detail?: string }>;
      toastError(
        axiosError.response?.data?.error ||
          axiosError.response?.data?.detail ||
          "Failed to save order",
      );
    } finally {
      setPlacingOrder(false);
    }
  };

  const handleProceedWithSave = async () => {
    setShowMergeWarning(false);

    setPlacingOrder(true);
    try {
      for (const group of duplicateGroups) {
        const firstItemId = group.items[0].id;
        await orderApi.updateItem(firstItemId, {
          ordered_quantity: String(group.totalMetres),
        });
        for (let i = 1; i < group.items.length; i++) {
          await orderApi.deleteItem(Number(id), group.items[i].id);
        }
      }
      const res = await orderApi.getOne(Number(id));
      setOrders(res);

      await orderApi.saveEdit(Number(id), {
        expected_delivery_date: expectedDeliveryDate || null,
        preferred_transport: preferredTransport
          ? parseInt(preferredTransport)
          : null,
        notes: notes || null,
      });
      toastSuccess("Order saved successfully!");
      router.push(`/agent/order/status/${id}`);
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string; detail?: string }>;
      toastError(
        axiosError.response?.data?.error ||
          axiosError.response?.data?.detail ||
          "Failed to save order",
      );
    } finally {
      setPlacingOrder(false);
    }
  };

  useEffect(() => {
    setLoading(true);

    const fetchData = async () => {
      try {
        const res = await orderApi.getOne(Number(id));

        setOrders(res);
        setExpectedDeliveryDate(
          res.expected_delivery_date ? res.expected_delivery_date : "",
        );

        setPreferredTransport(
          res.preferred_transport ? String(res.preferred_transport) : "",
        );
        setNotes(res.notes || "");
      } catch (e) {
        console.error("Error fetching order details:", e);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    };

    const fetchTransports = async () => {
      setLoadingTransports(true);

      try {
        const response = await transportApi.getActive();

        const formatted = response.map((transport) => ({
          value: transport.id.toString(),
          label: transport.name,
        }));

        setTransports(formatted);
      } catch (error) {
        console.error("Error fetching transports:", error);
      } finally {
        setLoadingTransports(false);
      }
    };

    fetchData();
    fetchTransports();
  }, []);

  useEffect(() => {
    if (loadError) {
      toastError("Server Error");
      router.push(`/agent/order/status/${id}`);
    }
  }, [loadError, router, id]);

  if (loading) return <PageLoading />;

  return (
    <div className="min-h-screen bg-gray-50/50 pb-32">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 py-6 sticky top-0 z-10">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={handleBack}
              className="p-2 rounded-xl hover:bg-gray-50 text-gray-400 transition-colors"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="flex flex-col">
              <h1 className="text-xl font-black text-gray-900 leading-tight">
                Edit Order
              </h1>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                Modify Items
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto px-0 pt-8">
        {/* Customer Card */}
        {orders && orders.items.length > 0 && (
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Package size={16} className="text-primary" />
              <h3 className="text-sm font-black text-gray-900">
                Delivery Options
              </h3>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5 block">
                  Expected Delivery Date
                </label>

                <input
                  type="date"
                  value={expectedDeliveryDate}
                  onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                  className="w-full px-3 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:border-primary focus:ring-2 focus:ring-primary/10 text-sm"
                />

                <p className="text-[9px] text-gray-400 mt-1">
                  Leave empty for “Whenever”
                </p>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5 block">
                  Preferred Transport
                </label>

                <select
                  value={preferredTransport}
                  onChange={(e) => setPreferredTransport(e.target.value)}
                  disabled={loadingTransports}
                  className="w-full px-3 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:border-primary focus:ring-2 focus:ring-primary/10 text-sm appearance-none"
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
            <div className="mt-4">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5 block">
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
        )}

        {/* Items Section Header */}
        <div className="flex justify-between items-end mb-6">
          <div className="flex flex-col">
            <h2 className="text-xl font-black text-gray-900">Fabric Lines</h2>
            <div className="flex gap-2 items-center mt-1">
              <span className="text-gray-400 text-[10px] font-bold uppercase tracking-wider">
                Selected
              </span>
              <div className="bg-amber-100 text-amber-600 rounded-full py-0.5 px-3 border border-amber-200">
                <span className="font-bold text-xs">
                  {orders?.items.length || 0}
                </span>
              </div>
            </div>
          </div>
          <StockFlowButton
            text="Add Fabric"
            variant="filled"
            icon={<Plus className="size-4" />}
            onClick={() => router.push(`/agent/order/edit/${id}/scanner`)}
            className="shadow-lg shadow-primary/20 ring-1 ring-primary/10 transition-all active:scale-95"
          />
        </div>

        {/* Items List */}
        <div className="space-y-4">
          {!orders || orders.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 bg-white rounded-3xl border border-dashed border-gray-200">
              <ShoppingBag size={48} className="text-gray-200 mb-4" />
              <p className="text-gray-400 font-bold">No fabrics added yet</p>
              <p className="text-[10px] text-gray-300 uppercase tracking-widest mt-1">
                Scan a fabric QR to add metres
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
              <OrderItem
                orderId={orders.id}
                items={orders.items}
                isDeletable={true}
                isEditable={true}
              />
            </div>
          )}
        </div>

        {/* Order Totals */}
        {orders && orders.items.length > 0 && (
          <div className="mt-8">
            <OrderTotals
              totalMetres={totalMetres}
              totalLines={orders.items.length}
              totalPrice={totalMoney}
              onPlaceOrder={handleSaveChanges}
              isLoading={placingOrder}
              buttonText="Save Changes"
            />
          </div>
        )}

        {/* Merge Warning Modal */}
        {showMergeWarning && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                    <AlertTriangle className="text-amber-500" size={20} />
                  </div>
                  <h3 className="text-lg font-black text-gray-900">
                    Duplicate Fabrics
                  </h3>
                </div>
                <button
                  onClick={() => setShowMergeWarning(false)}
                  className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
                >
                  <X size={20} className="text-gray-400" />
                </button>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                The same colour was scanned more than once. They will be
                combined into one line with the total metres.
              </p>
              <div className="space-y-3 mb-6 max-h-48 overflow-y-auto">
                {duplicateGroups.map((group, idx) => (
                  <div
                    key={idx}
                    className="bg-amber-50 rounded-xl p-3 border border-amber-200"
                  >
                    <p className="font-bold text-gray-900 text-sm">
                      {group.fabric_name}
                      {group.variant_display_order
                        ? ` — ${group.variant_display_order}`
                        : ""}
                    </p>
                    <p className="text-xs mt-1">
                      {group.items.map((item, i) => (
                        <span key={item.id}>
                          <span className="font-semibold text-gray-700">
                            {formatMeters(item.metres)} m
                          </span>
                          {i < group.items.length - 1 && (
                            <span className="text-gray-400"> + </span>
                          )}
                        </span>
                      ))}
                      <span className="text-gray-400"> = </span>
                      <span className="font-bold text-amber-600">
                        {formatMeters(group.totalMetres)} m
                      </span>
                    </p>
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowMergeWarning(false)}
                  className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 font-bold text-sm hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleProceedWithSave}
                  disabled={placingOrder}
                  className="flex-1 py-3 rounded-xl bg-primary text-white font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {placingOrder ? "Merging..." : "Proceed"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
