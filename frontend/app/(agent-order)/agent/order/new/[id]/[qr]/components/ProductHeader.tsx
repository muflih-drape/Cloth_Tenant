"use client";

import { ArrowLeft } from "lucide-react";

interface ProductHeaderProps {
  isEditMode: boolean;
  onBack: () => void;
}

export default function ProductHeader({ isEditMode, onBack }: ProductHeaderProps) {
  return (
    <div className="bg-white border-b border-gray-100 px-6 py-6 sticky top-0 z-10">
      <div className="max-w-md mx-auto flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 rounded-xl hover:bg-gray-50 text-gray-400 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex flex-col">
            <h1 className="text-xl font-black text-gray-900 leading-tight">
              Item Details
            </h1>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
              {isEditMode ? "Editing Item" : "Step 4: Configure Item"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}