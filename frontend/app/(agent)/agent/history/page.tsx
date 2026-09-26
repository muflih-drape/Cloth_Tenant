"use client";

import AgentOrderList from "@/components/pages/agent/orderList/OrderList";
import { useBackButton } from "@/util/useBackButton";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

export default function History() {
  const router = useRouter();

  useBackButton({
    onBack: useCallback(() => {
      router.push("/agent/");
    }, [router]),
  });
  return (
    <div className="min-h-screen min-w-full px-4 bg-gray-50/30">
      <AgentOrderList pageOrderStatus="COMPLETED" />
    </div>
  );
}
