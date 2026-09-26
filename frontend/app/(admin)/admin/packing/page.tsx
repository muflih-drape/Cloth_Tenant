"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronRight, Loader2, Package, Search } from "lucide-react";
import { fabricApi } from "@/lib/api/item";
import { VariantAllItem, formatMeters, toMeters } from "@/types/item";
import { PageLoading } from "@/components/ui/Loading";

/**
 * Pick the roll to pack. Rolls that still have unfulfilled demand float to the
 * top, because those are the ones holding orders up.
 */
export default function PackingRollPicker() {
  const router = useRouter();
  const [rolls, setRolls] = useState<VariantAllItem[]>([]);
  const [demand, setDemand] = useState<Record<number, string>>({});
  const [backordered, setBackordered] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [allVariants, outstanding] = await Promise.all([
          fabricApi.getAllVariants(),
          fabricApi.getOutstandingDemand(),
        ]);
        if (cancelled) return;

        setRolls(allVariants);
        setDemand(
          Object.fromEntries(
            outstanding.map((row) => [row.variant, row.outstanding_meters]),
          ),
        );
        setBackordered(
          new Set(outstanding.filter((row) => row.is_backordered).map((row) => row.variant)),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rolls
      .filter(
        (roll) =>
          !query ||
          roll.fabric_name.toLowerCase().includes(query) ||
          (roll.display_order ?? "").toLowerCase().includes(query),
      )
      .sort((a, b) => {
        const demandDiff = toMeters(demand[b.id] ?? 0) - toMeters(demand[a.id] ?? 0);
        if (demandDiff !== 0) return demandDiff;
        if (backordered.has(a.id) !== backordered.has(b.id)) {
          return backordered.has(a.id) ? -1 : 1;
        }
        return a.fabric_name.localeCompare(b.fabric_name);
      });
  }, [rolls, demand, backordered, search]);

  const openBoard = (variantId: number) => {
    setWorking(true);
    router.push(`/admin/packing/${variantId}`);
  };

  if (loading) return <PageLoading text="Loading rolls…" />;

  return (
    <div className="pb-8">
      <div className="px-4 pt-6 pb-3">
        <h1 className="text-xl font-extrabold text-gray-900">Packing</h1>
        <p className="text-sm text-gray-400 mt-1 font-medium">
          Allocate cloth to the orders waiting on it
        </p>
      </div>

      <div className="px-4 pb-3">
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            placeholder="Search fabrics…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full pl-9 pr-3 py-2.5 bg-white border border-gray-200 rounded-xl font-medium text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
          />
        </div>
      </div>

      <div className="px-4 space-y-1.5">
        {visible.length === 0 ? (
          <div className="py-12 text-center">
            <Package size={40} className="mx-auto text-gray-200 mb-2" />
            <p className="text-sm text-gray-400">No fabrics match that search</p>
          </div>
        ) : (
          visible.map((roll) => {
            const owed = toMeters(demand[roll.id] ?? 0);
            const isOwed = owed > 0;
            return (
              <button
                key={roll.id}
                onClick={() => openBoard(roll.id)}
                disabled={working}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-200 bg-white hover:border-primary/40 hover:bg-gray-50/50 transition-colors text-left disabled:opacity-60"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold text-gray-900 truncate">
                      {roll.fabric_name}
                    </p>
                    {backordered.has(roll.id) && (
                      <span className="inline-flex items-center gap-1 text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-md uppercase font-bold tracking-tighter border border-red-200">
                        <AlertTriangle size={9} />
                        Oversubscribed
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {roll.display_order || "No colour"} ·{" "}
                    {formatMeters(roll.stock_meters)} m on the roll
                    {isOwed && (
                      <span className="text-amber-600 font-bold">
                        {" "}
                        · {formatMeters(owed)} m owed
                      </span>
                    )}
                  </p>
                </div>
                {working ? (
                  <Loader2 size={16} className="text-gray-300 animate-spin" />
                ) : (
                  <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
