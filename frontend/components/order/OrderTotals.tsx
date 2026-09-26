"use client";

interface OrderTotalsProps {
  totalSets: number;
  totalPieces: number;
  totalPrice: number;
  onPlaceOrder?: () => void;
  isLoading?: boolean;
  buttonText?: string;
  showButton?: boolean;
}

export default function OrderTotals({
  totalSets,
  totalPieces,
  totalPrice,
  onPlaceOrder,
  isLoading = false,
  buttonText = "Place Order",
  showButton = true,
}: OrderTotalsProps) {
  return (
    <div className="bg-gradient-to-r from-primary/5 to-primary/10 rounded-3xl p-4 border border-primary/20">
      <p className="text-[10px] text-primary/60 uppercase font-black tracking-widest mb-2">
        Order Summary
      </p>

      <div className="flex items-center justify-between gap-3">
        {/* Stats row */}
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-black text-gray-900 leading-none">
              {totalSets}
            </span>
            <span className="text-xs text-gray-400">Sets</span>
          </div>
          <span className="text-gray-300 text-sm">|</span>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-black text-gray-900 leading-none">
              {totalPieces}
            </span>
            <span className="text-xs text-gray-400">pcs</span>
          </div>
          <span className="text-gray-300 text-sm">|</span>
          <span className="text-xl font-black text-primary leading-none">
            ₹{totalPrice.toLocaleString("en-IN")}
          </span>
        </div>

        {/* Button */}
        {showButton && onPlaceOrder && (
          <button
            onClick={onPlaceOrder}
            disabled={isLoading || totalSets === 0}
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
