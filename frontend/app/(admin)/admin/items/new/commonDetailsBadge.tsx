"use client";

import { Pencil } from "lucide-react";
import type { FabricDetails } from "@/types/item";

interface Props {
  common: FabricDetails;
  onEdit?: () => void; // if provided, shows edit button
}

export default function CommonDetailsBadge({ common, onEdit }: Props) {
  return (
    <div className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-2xl px-4 py-3 gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold truncate leading-tight">
          {common.name || <span className="text-gray-300 font-normal">No name</span>}
        </p>
        <p className="text-xs text-gray-400">
          {common.price_per_meter
            ? `₹${common.price_per_meter}/m`
            : "—"}
          {common.description && (
            <span className="ml-2 text-gray-300 truncate hidden sm:inline">
              {common.description}
            </span>
          )}
        </p>
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
