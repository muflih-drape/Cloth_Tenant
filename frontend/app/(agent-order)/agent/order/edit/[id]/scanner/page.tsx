"use client";

import ScannerPage from "@/components/pages/ScannerPage";
import { ArrowLeft, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEditGuard } from "@/lib/useEditGuard";
import { useBackButton } from "@/util/useBackButton";

export default function EditOrderScannerPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const { handleBack } = useEditGuard(id);

  useBackButton({
    onBack: () => {
      handleBack();
    },
  });

  return (
    <div className="min-h-screen bg-gray-50/50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-6 sticky top-0 z-10">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={handleBack}
              className="p-2 rounded-xl hover:bg-gray-50 text-gray-400 transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="flex flex-col">
              <h1 className="text-xl font-black text-gray-900 leading-tight">
                Scan Item
              </h1>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                Edit Mode
              </p>
            </div>
          </div>
          <button
            onClick={() => router.push(`/agent/order/edit/${id}`)}
            className="p-2 rounded-xl hover:bg-rose-50 text-rose-500 transition-colors border border-transparent hover:border-rose-100"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      <div className="flex-1 max-w-md mx-auto w-full px-6 py-10 flex flex-col items-center justify-center">
        <ScannerPage id={id} basePath="/agent/order/edit" />
      </div>
    </div>
  );
}
