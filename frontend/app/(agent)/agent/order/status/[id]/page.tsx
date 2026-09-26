"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { orderApi } from "@/lib/api/order";
import { OrderResponse } from "@/types/order";
import OrderDetailHeader from "@/components/pages/agent/order/OrderDetailHeader";
import OrderDetailItems from "@/components/pages/agent/order/OrderDetailItems";
import OrderLogs from "@/components/pages/order/OrderLogs";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import { toastSuccess, toastError } from "@/lib/toast";
import { Trash2, Package, Pencil } from "lucide-react";
import { useBackButton } from "@/util/useBackButton";
import OrderSummary from "@/components/pages/order/OrderSummary";
import { transportApi } from "@/lib/api/transport";

export default function Page() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OrderResponse>();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [startingEdit, setStartingEdit] = useState(false);

  useBackButton({
    onBack: useCallback(() => {
      router.push("/agent/");
    }, [router]),
  });

  const [transports, setTransports] = useState<
    { value: string; label: string }[]
  >([]);

  const fetchData = useCallback(async () => {
    try {
      const response = await orderApi.getOne(Number(id));
      const transportData = await transportApi.getActive();
      const formattedTransports = transportData.map((transport) => ({
        value: transport.id.toString(),
        label: transport.name,
      }));
      setTransports(formattedTransports);
      setData(response);
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleViewInvoice = () => {
    localStorage.setItem("orderKey", id);
    router.push("/agent/order/orderform");
  };

  const handleDeleteOrder = async () => {
    if (!id) return;
    setDeleting(true);
    try {
      await orderApi.agentDelete(Number(id));
      toastSuccess("Order deleted successfully");
      router.back();
    } catch (err) {
      toastError("Failed to delete order");
      console.error(err);
    } finally {
      setDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  const handleEditOrder = async () => {
    if (!id) return;
    setStartingEdit(true);
    try {
      await orderApi.startEdit(Number(id));
      localStorage.setItem("orderKey", id);
      router.push(`/agent/order/edit/${id}`);
    } catch (err) {
      toastError("Failed to start editing");
      console.error(err);
    } finally {
      setStartingEdit(false);
    }
  };

  if (loading) return <h2 className="flex justify-center mt-10">Loading...</h2>;

  const isDeletable = data?.status === "PENDING";
  const showPackingStatus = data?.status === "PACKED";

  const getPreferredTransport = (id: string | number) => {
    return (
      transports.find((transport) => transport.value === id.toString())
        ?.label ?? ""
    );
  };

  return (
    <div className="min-h-screen bg-white pb-6">
      <OrderDetailHeader
        orderId={id}
        backHref="/agent"
        onViewInvoice={handleViewInvoice}
      />

      <div className="px-4 pt-4 max-w-4xl mx-auto">
        {data?.customer_details && data?.agent_details && (
          <OrderSummary
            customer={data?.customer_details}
            agent={data?.agent_details}
            orderDate={data?.created_at?.slice(0, 10) ?? ""}
            status={data?.status ?? ""}
            preferredTransport={
              data?.preferred_transport
                ? getPreferredTransport(data?.preferred_transport)
                : undefined
            }
            expectedDeliveryDate={
              data?.expected_delivery_date?.slice(0, 10) ?? ""
            }
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

        {showPackingStatus && (
          <div className="bg-gray-50 rounded-xl p-4 mb-4 border border-gray-100">
            <div className="flex items-center gap-2 mb-3">
              <Package size={16} className="text-gray-500" />
              <h3 className="text-sm font-bold text-gray-700">
                Packing Status
              </h3>
            </div>
            <div className="space-y-2">
              {data?.items.map((item) => {
                const totalPieces = (item.piece_count || 1) * item.quantity;
                const packedPieces = item.packed_quantity || 0;
                const isFullyPacked = packedPieces >= totalPieces;
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="text-black truncate flex-1">
                      {item.item_name}
                    </span>
                    <span
                      className={`font-medium ${isFullyPacked ? "text-green-600" : "text-amber-600"}`}
                    >
                      {packedPieces} / {totalPieces} pcs
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <OrderDetailItems
          items={data?.items}
          orderId={Number(id)}
          status={data?.status}
          onRefresh={fetchData}
        />

        {isDeletable && (
          <div className="mt-6 pt-4 border-t border-gray-100 flex gap-3">
            <StockFlowButton
              text="Edit"
              icon={<Pencil size={16} />}
              onClick={handleEditOrder}
              variant="outline"
              fullWidth
              className="border-blue-200 text-blue-500 hover:bg-blue-500 hover:text-white transition duration-300"
              disabled={startingEdit}
            />
            {/*<StockFlowButton
              text="Delete"
              icon={<Trash2 size={16} />}
              onClick={() => setShowDeleteDialog(true)}
              variant="outline"
              fullWidth
              className="border-red-200 text-red-500 hover:bg-red-500 hover:text-white transition duration-300"
            />*/}
          </div>
        )}

        <OrderLogs orderId={Number(id)} />
      </div>

      {showDeleteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              Delete Order?
            </h3>
            <p className="text-sm text-gray-500 mb-6">
              {data?.status !== "DRAFT"
                ? "This will return the stock back to the warehouse. This action cannot be undone."
                : "Are you sure you want to delete this order?"}
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
                onClick={handleDeleteOrder}
                disabled={deleting}
                className="flex-1 py-3 px-4 rounded-xl bg-red-500 text-white font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
