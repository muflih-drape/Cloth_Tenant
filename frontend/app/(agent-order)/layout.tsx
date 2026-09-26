import { SizeRangeProvider } from "@/context/SizeRangeContext";
import { OrderFlowProvider } from "@/context/OrderFlowContext";

export default function OrderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="admin-order-layout">
      <SizeRangeProvider>
        <OrderFlowProvider mode="agent">{children}</OrderFlowProvider>
      </SizeRangeProvider>
    </div>
  );
}
