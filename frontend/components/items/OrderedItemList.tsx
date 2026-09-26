"use client";

import { useMemo } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { OutstandingDemandRow, formatMeters, toMeters } from "@/types/item";

interface OutstandingFabricGroup {
  fabric: string;
  fabricId: number;
  /** Metres still wanted across every open order line for this fabric. */
  outstandingMeters: number;
  /** Metres on hand across the fabric's colours. */
  stockMeters: number;
  colours: OutstandingDemandRow[];
  backordered: boolean;
}

interface OrderedItemListProps {
  items: OutstandingDemandRow[];
  onItemClick?: (fabricId: number) => void;
}

export default function OrderedItemList({
  items,
  onItemClick,
}: OrderedItemListProps) {
  const grouped = useMemo(() => {
    const map = new Map<string, OutstandingFabricGroup>();
    for (const row of items) {
      const existing = map.get(row.fabric);
      if (existing) {
        existing.outstandingMeters += toMeters(row.outstanding_meters);
        existing.stockMeters += toMeters(row.stock_meters);
        existing.backordered = existing.backordered || row.is_backordered;
        existing.colours.push(row);
      } else {
        map.set(row.fabric, {
          fabric: row.fabric,
          fabricId: row.fabric_id,
          outstandingMeters: toMeters(row.outstanding_meters),
          stockMeters: toMeters(row.stock_meters),
          backordered: row.is_backordered,
          colours: [row],
        });
      }
    }
    // Shortest cover first: these are the rolls that need packing soonest.
    return Array.from(map.values()).sort((a, b) => {
      if (a.backordered !== b.backordered) return a.backordered ? -1 : 1;
      return b.outstandingMeters - a.outstandingMeters;
    });
  }, [items]);

  if (grouped.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-300">
        <Info size={48} className="mb-4" />
        <h2 className="text-lg font-bold text-gray-400">Nothing outstanding</h2>
        <p className="text-sm text-gray-400 mt-1">
          Every order has been fully packed
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {grouped.map((group) => (
        <button
          key={group.fabricId}
          onClick={() => onItemClick?.(group.fabricId)}
          className="w-full p-3 rounded-md border border-gray-300 bg-white hover:bg-gray-50/50 transition-colors text-left cursor-pointer"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <h6 className="font-bold text-gray-900 text-sm truncate">{group.fabric}</h6>
            {group.backordered && (
              <span className="inline-flex items-center gap-1 text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-md uppercase font-bold tracking-tighter border border-red-200">
                <AlertTriangle size={9} />
                Oversubscribed
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
            <span>
              <span className="font-bold text-gray-900">
                {formatMeters(group.outstandingMeters)} m
              </span>{" "}
              owed
            </span>
            <span className="text-gray-200">•</span>
            <span>
              <span className="font-bold text-gray-900">
                {formatMeters(group.stockMeters)} m
              </span>{" "}
              in stock
            </span>
            <span className="text-gray-200">•</span>
            <span>
              {group.colours.length} colour{group.colours.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5 mt-2">
            {group.colours.map((row) => (
              <span
                key={row.variant}
                className={`text-[11px] px-2 py-1 rounded-md border ${
                  row.is_backordered
                    ? "bg-red-50 border-red-200 text-red-700"
                    : "bg-gray-50 border-gray-200 text-gray-700"
                }`}
              >
                {row.display_order || `Variant #${row.variant}`}:{" "}
                <span className="font-bold">{formatMeters(row.outstanding_meters)} m</span>{" "}
                owed
              </span>
            ))}
          </div>
        </button>
      ))}
    </div>
  );
}
