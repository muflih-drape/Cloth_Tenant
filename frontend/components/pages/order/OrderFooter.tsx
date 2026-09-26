"use client";
import { Truck, CheckCircle2, Info, PackageCheck } from "lucide-react";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import { formatMeters } from "@/types/item";

interface OrderFooterProps {
  status?: string;
  /** True when every metre on the order has been allocated by a packing round. */
  fullyPacked: boolean;
  /** Metres already allocated, even when the order is not fully packed. */
  allocatedMeters: number;
  onDispatch: () => void;
}

/**
 * The order's next action. There is no "complete packing" button: allocation is
 * what makes an order packed, and the backend flips the status itself once every
 * line is fully allocated.
 *
 * An order that is only partly allocated can still be sent out — whatever metres
 * are on the cloth go with the truck — but the admin has to say why in the
 * dispatch dialog. Doing so closes the order and writes off the remainder.
 */
export default function OrderFooter({
  status,
  fullyPacked,
  allocatedMeters,
  onDispatch,
}: OrderFooterProps) {
  if (status === "DISPATCHED") {
    return (
      <div className="fixed bottom-6 left-0 right-0 px-4 max-w-4xl mx-auto flex justify-center">
        <div className="bg-green-50 text-green-700 px-8 py-3 rounded-2xl border border-green-200 font-bold flex items-center gap-2">
          <CheckCircle2 size={20} />
          Order has been dispatched
        </div>
      </div>
    );
  }

  if (!fullyPacked) {
    if (status === "DRAFT") return null;

    // Some cloth is cut and ready, the rest is still owed: offer a partial
    // dispatch rather than stranding what is already packed.
    if (allocatedMeters > 0) {
      return (
        <div className="fixed bottom-6 left-0 right-0 px-4 max-w-4xl mx-auto">
          <div className="bg-amber-50 text-amber-800 border border-amber-200 rounded-2xl px-5 py-3 mb-2 flex items-center gap-2 text-sm font-bold">
            <Info size={18} className="flex-shrink-0" />
            {formatMeters(allocatedMeters)} m packed, rest is still owed
          </div>
          <StockFlowButton
            text={`Dispatch ${formatMeters(allocatedMeters)} m ready`}
            icon={<PackageCheck />}
            onClick={onDispatch}
            className="w-full shadow-xl transform active:scale-95 transition-all text-white py-4 px-10 rounded-2xl"
          />
        </div>
      );
    }

    return (
      <div className="fixed bottom-6 left-0 right-0 px-4 max-w-4xl mx-auto flex justify-center">
        <div className="bg-yellow-50 text-yellow-700 px-8 py-3 rounded-2xl border border-yellow-200 font-bold flex items-center gap-2">
          <Info size={20} />
          Waiting on a packing round
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-6 left-0 right-0 px-4 max-w-4xl mx-auto flex justify-center">
      <StockFlowButton
        text="Confirm Dispatch"
        icon={<Truck />}
        onClick={onDispatch}
        className="w-full sm:w-auto shadow-xl transform active:scale-95 transition-all text-white py-4 px-10 rounded-2xl"
      />
    </div>
  );
}
