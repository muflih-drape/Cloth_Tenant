"use client";
import { CheckCircle2, Info, PackageCheck, Truck } from "lucide-react";
import { formatMeters } from "@/types/item";

interface OrderFooterProps {
  status?: string;
  /** True when every metre on the order has been allocated by a packing round. */
  fullyPacked: boolean;
  /** Metres already allocated, even when the order is not fully packed. */
  allocatedMeters: number;
  /**
   * How many sealed bundles are still sitting in the warehouse, if any is known.
   * This is what a box to send out actually looks like, so the bar counts boxes
   * rather than orderings.
   */
  pendingBundles?: number;
  /** How many of those boxes have already gone out. */
  dispatchedBundles?: number;
  /** True once every bundle on the order has gone and nothing is still owed. */
  fullyDispatched?: boolean;
}

/**
 * The order's next action, said plainly at the foot of the page.
 *
 * There is no "complete packing" button: allocation is what makes an order packed,
 * and the backend flips the status itself once every line is fully allocated.
 *
 * There is no "dispatch" button either, and deliberately so. A dispatch is a sealed
 * bundle leaving the warehouse, so it is done on the bundle itself -- one box at a
 * time, in the packing panel, where the slip for that same box is printed. An order
 * can go out over several loads, which a single button on the order cannot express:
 * the first two boxes on Monday's truck and the third on Friday's would leave no way
 * to record what happened.
 *
 * What is left here is a count of the boxes, and the note that the order still owes
 * cloth. Both are things an admin needs to see without hunting for them.
 */
export default function OrderFooter({
  status,
  fullyPacked,
  allocatedMeters,
  pendingBundles = 0,
  dispatchedBundles = 0,
  fullyDispatched = false,
}: OrderFooterProps) {
  if (fullyDispatched || status === "DISPATCHED") {
    return (
      <div className="fixed bottom-6 left-0 right-0 px-4 max-w-4xl mx-auto flex justify-center">
        <div className="bg-green-50 text-green-700 px-8 py-3 rounded-2xl border border-green-200 font-bold flex items-center gap-2">
          <CheckCircle2 size={20} />
          Order has been dispatched
        </div>
      </div>
    );
  }

  if (pendingBundles > 0) {
    return (
      <div className="fixed bottom-6 left-0 right-0 px-4 max-w-4xl mx-auto">
        <div
          className={`rounded-2xl px-5 py-3 flex items-center gap-2 text-sm font-bold ${
            fullyPacked
              ? "bg-blue-50 text-blue-800 border border-blue-200"
              : "bg-amber-50 text-amber-800 border border-amber-200"
          }`}
        >
          <PackageCheck size={18} className="flex-shrink-0" />
          {pendingBundles} sealed bundle{pendingBundles === 1 ? "" : "s"} ready
          to dispatch
          {dispatchedBundles > 0 && (
            <span className="font-semibold text-gray-600">
              {" · "}
              {dispatchedBundles} already gone
            </span>
          )}
          {!fullyPacked && (
            <span className="font-semibold text-gray-600">
              {" · "}
              {formatMeters(allocatedMeters)} m packed, rest is still owed
            </span>
          )}
        </div>
      </div>
    );
  }

  if (!fullyPacked) {
    if (status === "DRAFT") return null;

    // Some cloth is cut and ready, the rest is still owed: say so, rather than
    // stranding what is already packed with no indication of where it went.
    if (allocatedMeters > 0) {
      return (
        <div className="fixed bottom-6 left-0 right-0 px-4 max-w-4xl mx-auto">
          <div className="bg-amber-50 text-amber-800 border border-amber-200 rounded-2xl px-5 py-3 flex items-center gap-2 text-sm font-bold">
            <Info size={18} className="flex-shrink-0" />
            {formatMeters(allocatedMeters)} m packed, rest is still owed
          </div>
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

  // Fully packed with no sealed bundle to send. Should not happen -- packing always
  // produces a bundle -- so it is reported rather than offered as an action.
  return (
    <div className="fixed bottom-6 left-0 right-0 px-4 max-w-4xl mx-auto flex justify-center">
      <div className="bg-blue-50 text-blue-800 px-8 py-3 rounded-2xl border border-blue-200 font-bold flex items-center gap-2">
        <Truck size={20} />
        All metres are packed and waiting to be sealed into a bundle
      </div>
    </div>
  );
}