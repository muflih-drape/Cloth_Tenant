"use client";

import { formatMeters } from "@/types/item";
import type { FabricRoll } from "@/types/item";

/**
 * How one roll reads in a list: its warehouse label, whatever the admin noted
 * about it, and how much of it is left of what arrived.
 *
 * This is the display half of a roll row, lifted out of the Physical Rolls panel
 * so that the Inventory page can show a colour's rolls in exactly the words the
 * panel uses. The panel's own row keeps its History / Print / Adjust buttons
 * around it, and this list adds none: reading the rolls is all the inventory page
 * is for.
 */
export default function RollSummary({ roll }: { roll: FabricRoll }) {
  return (
    <div className="flex-1 min-w-0">
      <p className="text-xs font-black text-gray-700">
        {roll.roll_number}
        {roll.note && (
          <span className="ml-2 font-normal text-gray-400">{roll.note}</span>
        )}
      </p>
      <p className="text-[11px] text-gray-400">
        {formatMeters(roll.remaining_meters)} m left of{" "}
        {formatMeters(roll.original_meters)}
        {roll.is_exhausted && " · used up"}
      </p>
    </div>
  );
}