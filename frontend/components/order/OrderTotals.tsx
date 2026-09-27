"use client";

import { formatMeters, toMeters } from "@/types/item";
import { EditTotalButton } from "./PriceOverrideDialog";

interface OrderTotalsProps {
  /** Total metres across every line, as a display string from the API. */
  totalMetres: string | number;
  totalLines: number;
  totalPrice: number;
  onPlaceOrder?: () => void;
  isLoading?: boolean;
  buttonText?: string;
  showButton?: boolean;
  /** The line arithmetic, shown struck through when the total was adjusted. */
  computedTotal?: number;
  isPriceOverridden?: boolean;
  /** Omitted when the order is not in a state where the total may be set. */
  onEditTotal?: () => void;
  isEditTotalDisabled?: boolean;
}

export default function OrderTotals({
  totalMetres,
  totalLines,
  totalPrice,
  onPlaceOrder,
  isLoading = false,
  buttonText = "Place Order",
  showButton = true,
  computedTotal,
  isPriceOverridden = false,
  onEditTotal,
  isEditTotalDisabled = false,
}: OrderTotalsProps) {
  return (
    <div className="bg-gradient-to-r from-primary/5 to-primary/10 rounded-3xl p-4 border border-primary/20">
      <p className="text-[10px] text-primary/60 uppercase font-black tracking-widest mb-2">
        Order Summary
      </p>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-black text-gray-900 leading-none">
              {formatMeters(totalMetres)}
            </span>
            <span className="text-xs text-gray-400">m</span>
          </div>
          <span className="text-gray-300 text-sm">|</span>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-black text-gray-900 leading-none">
              {totalLines}
            </span>
            <span className="text-xs text-gray-400">
              {totalLines === 1 ? "line" : "lines"}
            </span>
          </div>
          <span className="text-gray-300 text-sm">|</span>
          <div className="flex items-baseline gap-2">
            {isPriceOverridden && computedTotal !== undefined && (
              <span className="text-sm font-bold text-gray-400 line-through">
                ₹{Number(computedTotal).toLocaleString("en-IN")}
              </span>
            )}
            <span className="text-xl font-black text-primary leading-none">
              ₹{Number(totalPrice || 0).toLocaleString("en-IN")}
            </span>
            {onEditTotal && (
              <EditTotalButton
                onClick={onEditTotal}
                isOverridden={isPriceOverridden}
                disabled={isEditTotalDisabled}
              />
            )}
          </div>
        </div>

        {showButton && onPlaceOrder && (
          <button
            onClick={onPlaceOrder}
            disabled={isLoading || toMeters(totalMetres) === 0}
            className="shrink-0 flex items-center justify-center gap-2 bg-primary text-white font-bold py-2.5 px-4 rounded-2xl shadow-lg shadow-primary/30 hover:opacity-90 transition-all active:scale-95 disabled:opacity-50 text-sm whitespace-nowrap"
          >
            {isLoading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <span>{buttonText}</span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
