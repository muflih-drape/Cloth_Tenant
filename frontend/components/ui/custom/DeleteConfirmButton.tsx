"use client";

import { useState } from "react";
import { Trash2, AlertTriangle, X } from "lucide-react";

interface DeleteConfirmButtonProps {
  onConfirm: () => void;
  label?: string;
}

export default function DeleteConfirmButton({
  onConfirm,
  label = "this item",
}: DeleteConfirmButtonProps) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5 bg-red-50 border border-red-100 rounded-xl px-2.5 py-1.5">
        <AlertTriangle size={13} className="text-red-500 flex-shrink-0" />
        <span className="text-[10px] font-bold text-red-600 whitespace-nowrap">
          Delete {label}?
        </span>
        <button
          onClick={() => setConfirming(false)}
          className="ml-1 p-1 rounded-lg hover:bg-red-100 transition-colors"
          aria-label="Cancel delete"
        >
          <X size={13} className="text-red-400" />
        </button>
        <button
          onClick={() => {
            setConfirming(false);
            onConfirm();
          }}
          className="px-2 py-0.5 bg-red-500 text-white rounded-lg text-[10px] font-black hover:bg-red-600 active:scale-95 transition-all"
        >
          Confirm
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="p-2 rounded-xl text-red-500 hover:bg-red-50 transition-colors"
      aria-label="Delete"
    >
      <Trash2 size={20} />
    </button>
  );
}
