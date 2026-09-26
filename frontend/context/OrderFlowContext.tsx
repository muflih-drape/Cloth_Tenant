"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  getOrderAfterPlacePath,
  getOrderBasePath,
  type OrderFlowMode,
} from "@/lib/orderFlow";

type OrderFlowContextValue = {
  mode: OrderFlowMode;
};

const OrderFlowContext = createContext<OrderFlowContextValue>({
  mode: "agent",
});

export function OrderFlowProvider({
  mode,
  children,
}: {
  mode: OrderFlowMode;
  children: ReactNode;
}) {
  return (
    <OrderFlowContext.Provider value={{ mode }}>
      {children}
    </OrderFlowContext.Provider>
  );
}

export function useOrderFlow() {
  const { mode } = useContext(OrderFlowContext);
  const { user } = useAuth();
  const isAdmin = mode === "admin";

  return {
    mode,
    isAdmin,
    basePath: getOrderBasePath(mode),
    agentId: isAdmin ? undefined : user?.id,
    afterPlacePath: (orderId: number) => getOrderAfterPlacePath(mode, orderId),
  };
}
