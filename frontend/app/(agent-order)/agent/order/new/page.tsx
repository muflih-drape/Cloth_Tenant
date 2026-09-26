"use client";

import ListCustomer from "@/components/pages/ListCustomer";
import { useBackButton } from "@/util/useBackButton";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

export default function NewOrder() {
  const router = useRouter();

  useBackButton({
    onBack: () => {
      router.push("/agent");
    },
  });

  return (
    <div className="min-h-screen bg-gray-50/50 pb-32">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-6 sticky top-0 z-10">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/agent")}
              className="p-2 rounded-xl hover:bg-gray-50 text-gray-400 transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="flex flex-col">
              <h1 className="text-xl font-black text-gray-900 leading-tight">
                Create Order
              </h1>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                Step 1: Select Customer
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto">
        <ListCustomer />
      </div>
    </div>
  );
}
