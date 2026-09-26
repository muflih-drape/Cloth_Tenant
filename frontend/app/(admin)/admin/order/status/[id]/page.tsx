"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { orderApi } from "@/lib/api/order";
import { transportApi } from "@/lib/api/transport";
import { OrderResponse } from "@/types/order";
import OrderTabs, { Tab } from "@/components/pages/order/OrderTabs";
import OrderSummary from "@/components/pages/order/OrderSummary";
import OrderItemsSection from "@/components/pages/order/OrderItemsSection";
import OrderFooter from "@/components/pages/order/OrderFooter";
import OrderDetailHeader from "@/components/pages/admin/order-item/OrderDetailHeader";
import OrderLogs from "@/components/pages/order/OrderLogs";
import { toastSuccess } from "@/lib/toast";
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

  const [activeTab, setActiveTab] = useState<Tab>("Packing");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<OrderResponse>();
  const [isPackingMode, setIsPackingMode] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showDispatchDialog, setShowDispatchDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dispatchTransport, setDispatchTransport] = useState<string>("");
  const [lrNumber, setLrNumber] = useState<string>("");
  const [transports, setTransports] = useState<
    { value: string; label: string }[]
  >([]);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);

  const fetchData = useCallback(
    async (setInitialTab = false) => {
      try {
        const response = await orderApi.getOne(Number(id));
        setData(response);
        if (setInitialTab && response.status === "PACKED") {
          setActiveTab("Dispatching");
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    },
    [id],
  );

  useEffect(() => {
    setLoading(true);
    fetchData(true).finally(() => setLoading(false));
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

  const handlePackedChange = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  const handleUpdateStatus = async (newStatus: "PACKED" | "DISPATCHED") => {
    if (newStatus === "DISPATCHED" && anyItemPacked) {
      setShowDispatchDialog(true);
      return;
    } else if (newStatus === "PACKED") {
      await updateStatus(newStatus);
    }
  };

  const updateStatus = async (newStatus: "PACKED" | "DISPATCHED") => {
    try {
      setLoading(true);
      if (newStatus === "DISPATCHED") {
        await orderApi.dispatchOrder(Number(id));
      } else {
        await orderApi.update(Number(id), { status: newStatus });
      }
      await fetchData();
      if (newStatus === "PACKED") setIsPackingMode(false);
    } catch (err) {
      console.error("Error updating status:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmDispatch = async () => {
    setShowDispatchDialog(false);
    try {
      await orderApi.dispatchOrder(Number(id), {
        transport_company: dispatchTransport
          ? parseInt(dispatchTransport)
          : null,
        lr_number: lrNumber,
      });
      router.push("/admin");
    } catch (err) {
      console.error("Error dispatching order:", err);
    }
  };

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    setIsPackingMode(false);
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

  const anyItemPacked = data?.items.some(
    (item) => (item.packed_quantity ?? 0) > 0,
  );
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
        <OrderTabs activeTab={activeTab} onTabChange={handleTabChange} />

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
          activeTab={activeTab}
          isPackingMode={isPackingMode}
          onPackedChange={handlePackedChange}
          onTogglePackingMode={async () => {
            await fetchData();
            setIsPackingMode((prev) => !prev);
          }}
          status={data?.status}
          orderId={Number(id)}
        />

        <OrderLogs orderId={Number(id)} />
      </div>

      <OrderFooter
        activeTab={activeTab}
        status={data?.status}
        anyItemPacked={anyItemPacked!}
        isPackingMode={isPackingMode}
        onActionButtonClick={handleUpdateStatus}
      />

      {showDeleteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              Delete Order?
            </h3>
            <p className="text-sm text-gray-500 mb-6">
              This will return the stock back to the warehouse. This action
              cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteDialog(false)}
                className="flex-1 py-3 px-4 rounded-xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteClick}
                disabled={deleting}
                className="flex-1 py-3 px-4 rounded-xl bg-red-500 text-white font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDispatchDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              Dispatch Order
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Unpacked items will be returned to the warehouse.
            </p>

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
                className="flex-1 py-3 px-4 rounded-xl bg-primary text-white font-medium hover:bg-primary/90 transition-colors"
              >
                Dispatch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
