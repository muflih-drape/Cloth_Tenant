"use client";

import { PackagePlus } from "lucide-react";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";

interface SubmitButtonProps {
  isEditMode: boolean;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}

export default function SubmitButton({
  isEditMode,
  loading,
  disabled,
  onClick,
}: SubmitButtonProps) {
  return (
    <div className="px-4">
      <StockFlowButton
        text={isEditMode ? "Update Quantity" : "Add to Order"}
        variant="filled"
        icon={<PackagePlus />}
        onClick={onClick}
        disabled={loading || disabled}
        className="w-full py-4 active:scale-95 transition-all"
      />
    </div>
  );
}