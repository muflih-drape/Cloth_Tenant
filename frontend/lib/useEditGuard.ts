"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { orderApi } from "@/lib/api/order";

export function useEditGuard(id: string) {
  const router = useRouter();
  const hasCanceled = useRef(false);
  const idRef = useRef(id);

  idRef.current = id;

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasCanceled.current) return;
      hasCanceled.current = true;

      const url = `/api/orders/${idRef.current}/cancel-edit/`;
      navigator.sendBeacon(url);

      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const handleBack = useCallback(async () => {
    if (hasCanceled.current) {
      router.push(`/agent/order/status/${id}`);
      return;
    }
    hasCanceled.current = true;
    try {
      await orderApi.cancelEdit(Number(id));
    } catch {
    } finally {
      router.push(`/agent/order/status/${id}`);
    }
  }, [id, router]);

  return { handleBack };
}
