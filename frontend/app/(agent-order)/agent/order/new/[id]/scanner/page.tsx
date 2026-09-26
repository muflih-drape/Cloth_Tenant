"use client";

import ScannerPage from "@/components/pages/ScannerPage";
import { useBackButton } from "@/util/useBackButton";
import { ArrowLeft } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useOrderFlow } from "@/context/OrderFlowContext";

export default function OrderScannerPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const { basePath } = useOrderFlow();

  const [orderId] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;

    const stored = localStorage.getItem("orderKey");

    return stored ? Number(stored) : null;
  });

  useBackButton({
    onBack: () => {
      router.push(`${basePath}/${id}`);
    },
  });

  return (
    <div className="min-h-screen bg-gray-50/50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-6 sticky top-0 z-10">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push(`${basePath}/${id}`)}
              className="p-2 rounded-xl hover:bg-gray-50 text-gray-400 transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="flex flex-col">
              <h1 className="text-xl font-black text-gray-900 leading-tight">
                Scan Item
              </h1>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                Step 3: QR Scanner
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-md mx-auto w-full px-6 py-10 flex flex-col items-center justify-center">
        <ScannerPage id={id} orderId={orderId} basePath={basePath} />
      </div>
    </div>
  );
}
