import { OrderFlowProvider } from "@/context/OrderFlowContext";

export default function OrderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="admin-order-layout">
      <OrderFlowProvider mode="agent">{children}</OrderFlowProvider>
    </div>
  );
}
