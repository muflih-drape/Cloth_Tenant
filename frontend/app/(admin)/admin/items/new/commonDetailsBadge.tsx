"use client";

import { Pencil } from "lucide-react";
import type { CommonDetails } from "@/types/item";

interface Props {
  common: CommonDetails;
  onEdit?: () => void; // if provided, shows edit button
}

export default function CommonDetailsBadge({ common, onEdit }: Props) {
  return (
    <div className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-2xl px-4 py-3 gap-3">
      <div className="flex items-center gap-3 min-w-0">
        {/* Type chip */}
        <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-widest bg-gray-200 text-gray-500 rounded-full px-2.5 py-1">
          {common.type}
        </span>

        {/* Name + price */}
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate leading-tight">
            {common.name || (
              <span className="text-gray-300 font-normal">No name</span>
            )}
          </p>
          <p className="text-xs text-gray-400">
            {common.price ? `₹${common.price}` : "—"}
            {common.description && (
              <span className="ml-2 text-gray-300 truncate hidden sm:inline">
                {common.description}
              </span>
            )}
          </p>
        </div>
      </div>

      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="flex-shrink-0 p-2 rounded-full text-gray-400 hover:bg-gray-200 transition-colors"
          aria-label="Edit common details"
        >
          <Pencil size={14} />
        </button>
      )}
    </div>
  );
}
