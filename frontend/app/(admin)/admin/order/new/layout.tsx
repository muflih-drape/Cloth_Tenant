import { OrderFlowProvider } from "@/context/OrderFlowContext";

export default function AdminNewOrderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <OrderFlowProvider mode="admin">{children}</OrderFlowProvider>;
}
