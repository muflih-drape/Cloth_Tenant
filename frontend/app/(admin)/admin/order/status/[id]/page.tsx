"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { orderApi } from "@/lib/api/order";
import { transportApi } from "@/lib/api/transport";
import { OrderResponse } from "@/types/order";
import { formatMeters, toMeters } from "@/types/item";
import OrderSummary from "@/components/pages/order/OrderSummary";
import OrderItemsSection from "@/components/pages/order/OrderItemsSection";
import OrderFooter from "@/components/pages/order/OrderFooter";
import OrderDetailHeader from "@/components/pages/admin/order-item/OrderDetailHeader";
import OrderLogs from "@/components/pages/order/OrderLogs";
import { toastError, toastSuccess } from "@/lib/toast";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import { Trash2 } from "lucide-react";
import PinDeleteDialog from "@/components/ui/pinDeleteDialog";
import { useAuth } from "@/context/AuthContext";
import { PageLoading } from "@/components/ui/Loading";

export default function Page() {
  const { isSuperuser } = useAuth();
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<OrderResponse>();
  const [showDispatchDialog, setShowDispatchDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dispatchTransport, setDispatchTransport] = useState<string>("");
  const [lrNumber, setLrNumber] = useState<string>("");
  const [shortfallReason, setShortfallReason] = useState<string>("");
  const [transports, setTransports] = useState<
    { value: string; label: string }[]
  >([]);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const response = await orderApi.getOne(Number(id));
      setData(response);
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  useEffect(() => {
    const fetchTransports = async () => {
      try {
        const response = await transportApi.getActive();
        const formattedTransports = response.map((transport) => ({
          value: transport.id.toString(),
          label: transport.name,
        }));
        setTransports(formattedTransports);
      } catch (error) {
        console.error("Error fetching transports:", error);
      }
    };
    fetchTransports();
  }, []);

  // Set preferred transport only when both are available
  useEffect(() => {
    if (!data?.preferred_transport || transports.length === 0) return;
    const match = transports.find(
      (t) => t.value === data.preferred_transport?.toString(),
    );
    if (match) setDispatchTransport(match.value);
  }, [data, transports]);

  const handleItemsChange = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  const handleConfirmDispatch = async () => {
    if (isPartial && !shortfallReason.trim()) {
      toastError("Say why the order is going out short.");
      return;
    }
    setShowDispatchDialog(false);
    try {
      await orderApi.dispatchOrder(Number(id), {
        transport_company: dispatchTransport
          ? parseInt(dispatchTransport)
          : null,
        lr_number: lrNumber,
        // A partial dispatch has to say why, so the gap is auditable later.
        ...(isPartial
          ? { allow_partial: true, shortfall_reason: shortfallReason.trim() }
          : {}),
      });
      router.push("/admin");
    } catch (err) {
      console.error("Error dispatching order:", err);
    }
  };

  const handleDeleteClick = () => {
    if (isSuperuser) {
      if (
        !confirm(
          "Delete this order? Stock will be returned to inventory. This cannot be undone.",
        )
      )
        return;
      handleDeleteConfirm("");
      return;
    }
    setPinDialogOpen(true);
  };

  const handleDeleteConfirm = async (pin: string) => {
    if (!id) return;
    setDeleting(true);
    try {
      await orderApi.delete(Number(id), pin);
      toastSuccess("Order deleted successfully");
      router.push("/admin");
    } catch (err) {
      setDeleting(false);
      // Re-throw so PinDeleteDialog shows the error inside the dialog
      throw err;
    }
  };

  // Every metre has to be allocated before the order can go out on a truck in
  // full, but a partly-allocated order can still ship what is cut — the backend
  // keeps the remainder owed.
  const fullyPacked =
    (data?.items.length ?? 0) > 0 &&
    data!.items.every((item) => toMeters(item.outstanding_quantity) === 0);
  const allocatedMeters = (data?.items ?? []).reduce(
    (sum, item) => sum + toMeters(item.allocated_quantity),
    0,
  );
  const outstandingMeters = (data?.items ?? []).reduce(
    (sum, item) => sum + toMeters(item.outstanding_quantity),
    0,
  );
  const isPartial = !fullyPacked && allocatedMeters > 0;
  const isDeletable = data?.status === "PENDING" || data?.status === "PACKED";

  if (loading && !data) return <PageLoading />;

  return (
    <div className="min-h-screen bg-white pb-20">
      <PinDeleteDialog
        open={pinDialogOpen}
        onClose={() => setPinDialogOpen(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Order"
        description="Stock will be returned to inventory. This cannot be undone."
      />
      <OrderDetailHeader orderId={id} backHref="/admin" />

      <div className="px-4 pt-4 max-w-4xl mx-auto">
        {isDeletable && (
          <div className="flex justify-end w-full p-2">
            <StockFlowButton
              icon={
                deleting ? (
                  <span className="w-4 h-4 border-2 border-red-300 border-t-red-500 rounded-full animate-spin block" />
                ) : (
                  <Trash2 size={16} />
                )
              }
              onClick={handleDeleteClick}
              disabled={deleting}
              variant="outline"
              className="border-red-200 text-red-500 hover:bg-red-500 hover:text-white transition duration-300"
            />
          </div>
        )}

        {data?.customer_details && data?.agent_details && (
          <OrderSummary
            customer={data?.customer_details}
            agent={data?.agent_details}
            orderDate={data?.created_at?.slice(0, 10) ?? ""}
            status={data?.status ?? ""}
            preferredTransport={
              transports.find(
                (transport) =>
                  Number(transport.value) == data?.preferred_transport,
              )?.label ?? ""
            }
            expectedDeliveryDate={data?.expected_delivery_date ?? ""}
            dispatchTransport={
              transports.find(
                (transport) =>
                  Number(transport.value) == data?.transport_company,
              )?.label ?? ""
            }
            lrNumber={data?.lr_number ?? ""}
            notes={data?.notes ?? ""}
          />
        )}

        <OrderItemsSection
          items={data?.items}
          status={data?.status}
          orderId={Number(id)}
          onItemsChange={handleItemsChange}
        />

        <OrderLogs orderId={Number(id)} />
      </div>

      <OrderFooter
        status={data?.status}
        fullyPacked={fullyPacked}
        allocatedMeters={allocatedMeters}
        onDispatch={() => setShowDispatchDialog(true)}
      />

      {showDispatchDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              Dispatch Order
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Record the transport carrying this cloth out.
            </p>

            {isPartial && (
              <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200">
                <p className="text-xs font-bold text-amber-800">
                  {formatMeters(allocatedMeters)} m is cut and ready,{" "}
                  {formatMeters(outstandingMeters)} m is still owed.
                </p>
                <p className="text-[11px] text-amber-700 mt-1">
                  Dispatching short closes the order: the unpacking-ready
                  remainder is written off and stops competing for cloth. Only do
                  this once the customer has agreed to collect later.
                </p>
              </div>
            )}

            <div className="space-y-4 mb-6">
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1.5 block">
                  Transport Company
                </label>
                <select
                  value={dispatchTransport}
                  onChange={(e) => setDispatchTransport(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:border-primary focus:ring-2 focus:ring-primary/10 text-sm"
                >
                  <option value="">Select Transport</option>
                  {transports.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1.5 block">
                  LR Number
                </label>
                <input
                  type="text"
                  value={lrNumber}
                  onChange={(e) => setLrNumber(e.target.value)}
                  placeholder="Enter LR number"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:border-primary focus:ring-2 focus:ring-primary/10 text-sm"
                />
              </div>

              {isPartial && (
                <div>
                  <label className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1.5 block">
                    Reason for dispatching short
                  </label>
                  <input
                    type="text"
                    value={shortfallReason}
                    onChange={(e) => setShortfallReason(e.target.value)}
                    placeholder="e.g. customer will collect the rest later"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:border-primary focus:ring-2 focus:ring-primary/10 text-sm"
                  />
                  {!shortfallReason.trim() && (
                    <p className="text-[11px] text-gray-400 mt-1">
                      Required — the reason is saved on the order's log.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowDispatchDialog(false)}
                className="flex-1 py-3 px-4 rounded-xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDispatch}
                disabled={isPartial && !shortfallReason.trim()}
                className="flex-1 py-3 px-4 rounded-xl bg-primary text-white font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
              >
                {isPartial ? "Dispatch short" : "Dispatch"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
