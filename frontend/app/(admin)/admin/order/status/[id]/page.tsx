"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { orderApi } from "@/lib/api/order";
import { transportApi } from "@/lib/api/transport";
import { OrderResponse, OrderStatus } from "@/types/order";
import { toMeters } from "@/types/item";
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

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<OrderResponse>();
  const [deleting, setDeleting] = useState(false);
  const [transports, setTransports] = useState<
    { value: string; label: string }[]
  >([]);
  // How many sealed bundles are still in the warehouse, and how many have gone.
  // Reported up by the bundle panel, which already has the list, so the foot of
  // the page can say what is left without fetching them again.
  const [bundleCounts, setBundleCounts] = useState({
    pending: 0,
    dispatched: 0,
  });
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

  const handleItemsChange = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  // A line packed from this page can fill the last of the order's metres, which
  // promotes it to PACKED server-side. Apply that here so the header, the footer
  // and the lines all agree without refetching the order.
  const handleOrderStatusChange = useCallback((status: OrderStatus) => {
    setData((prev) => (prev ? { ...prev, status } : prev));
  }, []);

  const handleBundlesChange = useCallback(
    (counts: { pending: number; dispatched: number }) => {
      setBundleCounts(counts);
    },
    [],
  );

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

  // Every metre has to be allocated before the order counts as fully packed, but a
  // partly-allocated order is normal mid-way through dispatching bundle by bundle:
  // what is packed is in boxes that can go, and the rest is still owed.
  const fullyPacked =
    (data?.items.length ?? 0) > 0 &&
    data!.items.every((item) => toMeters(item.outstanding_quantity) === 0);
  const allocatedMeters = (data?.items ?? []).reduce(
    (sum, item) => sum + toMeters(item.allocated_quantity),
    0,
  );
  // A partly dispatched order stays deletable, and so does one whose bundles have
  // all gone. The server only puts back the cloth that never left -- what is on a
  // truck stays on a truck, so deleting the order cannot undo a dispatch, and
  // pretending otherwise by hiding the button would only hide that fact.
  const isDeletable =
    data?.status === "PENDING" ||
    data?.status === "PACKED" ||
    data?.status === "PARTIALLY_DISPATCHED";

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
          onOrderStatusChange={handleOrderStatusChange}
          onBundlesChange={handleBundlesChange}
          transportCompanyId={data?.transport_company ?? null}
          preferredTransportId={data?.preferred_transport ?? null}
        />

        <OrderLogs orderId={Number(id)} />
      </div>

{/* No dispatch button here any more. A dispatch belongs to a sealed bundle, and
          it is done from the bundle panel above where that bundle lives -- so an
          order that is two boxes out of three says exactly that, and each box can
          go on its own truck. */}
      <OrderFooter
        status={data?.status}
        fullyPacked={fullyPacked}
        allocatedMeters={allocatedMeters}
        pendingBundles={bundleCounts.pending}
        dispatchedBundles={bundleCounts.dispatched}
      />
    </div>
  );
}
