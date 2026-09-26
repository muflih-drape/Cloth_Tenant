"use client";

import React, { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { fabricApi } from "@/lib/api/item";
import { formatMeters } from "@/types/item";
import {
  computeInventorySummary,
  matchesStockFilter,
  type StockFilter,
  type FabricSummaryRow,
} from "@/lib/utils/inventorySummary";
import { ArrowBigLeft } from "lucide-react";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function StatCard({
  label,
  meters,
  value,
  detail,
}: {
  label: string;
  meters: number;
  value: number;
  detail?: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gray-400">
        {label}
      </p>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-4xl font-bold tabular-nums text-gray-900">
            {formatMeters(meters)}
          </p>
          <p className="mt-1 text-sm text-gray-500">metres in stock</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold tabular-nums text-gray-900">
            {formatCurrency(value)}
          </p>
          <p className="mt-1 text-sm text-gray-500">stock value</p>
        </div>
      </div>
      {detail && <p className="mt-4 text-xs text-gray-400">{detail}</p>}
    </div>
  );
}

type SortKey = "name" | "totalStock" | "totalValue";

const FILTERS: { key: StockFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "inStock", label: "In stock" },
  { key: "low", label: "Low" },
  { key: "out", label: "Sold out" },
];

function SortIcon({ active }: { active: boolean }) {
  return <span className={`ml-1 ${active ? "opacity-70" : "opacity-20"}`}>↕</span>;
}

const Summary: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  const [data, setData] = useState<Awaited<
    ReturnType<typeof fabricApi.getStockList>
  >>([]);
  const [loading, setLoading] = useState(true);

  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(false);
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");

  const fetchData = useCallback(async () => {
    try {
      setData(await fabricApi.getStockList());
    } catch (e) {
      console.error("Error fetching fabrics:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!isAuthenticated) {
      router.replace("/login");
      return;
    }
    fetchData();
  }, [isAuthenticated, router, fetchData]);

  const summary = useMemo(() => computeInventorySummary(data), [data]);

  const sortedItems = useMemo(() => {
    const filtered = summary.fabricSummaries.filter((row) =>
      matchesStockFilter(row, stockFilter),
    );

    return [...filtered].sort((a: FabricSummaryRow, b: FabricSummaryRow) => {
      if (sortKey === "name") {
        const cmp = a.name.localeCompare(b.name, undefined, { numeric: true });
        return sortAsc ? cmp : -cmp;
      }
      const av = a[sortKey];
      const bv = b[sortKey];
      return sortAsc ? av - bv : bv - av;
    });
  }, [summary, sortKey, sortAsc, stockFilter]);

  const filteredTotals = useMemo(
    () => ({
      stock: sortedItems.reduce((s, i) => s + i.totalStock, 0),
      value: sortedItems.reduce((s, i) => s + i.totalValue, 0),
    }),
    [sortedItems],
  );

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((prev) => !prev);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-indigo-200 border-t-black" />
          <p className="text-sm text-gray-500">Loading inventory…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-10 font-sans sm:px-8">
      <div>
        <button onClick={() => router.push("/admin/profile")}>
          <ArrowBigLeft />
        </button>
      </div>
      <div className="mx-auto max-w-5xl">
        <div className="mb-10">
          <h1 className="mt-1 text-2xl font-bold text-black">
            Inventory Summary
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Physical metres on the rolls, valued at each fabric&apos;s rate per
            metre.
          </p>
        </div>

        {/* Stat Cards */}
        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          <StatCard
            label="All Fabrics"
            meters={summary.totalStock}
            value={summary.totalValue}
            detail={`${summary.fabricCount} fabrics tracked`}
          />
          <StatCard
            label="Needs Restock"
            meters={summary.fabricSummaries
              .filter((r) => r.lowStockVariants > 0)
              .reduce((s, r) => s + r.totalStock, 0)}
            value={summary.fabricSummaries
              .filter((r) => r.lowStockVariants > 0)
              .reduce((s, r) => s + r.totalValue, 0)}
            detail={`${summary.lowStockCount} fabrics with a low colour`}
          />
          <StatCard
            label="Sold Out"
            meters={0}
            value={0}
            detail={`${summary.outOfStockCount} fabrics with no stock left`}
          />
        </div>

        {/* Table Controls */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-500">
            Per-Fabric Breakdown
          </h2>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setStockFilter(f.key)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  stockFilter === f.key
                    ? "bg-black text-white"
                    : "border border-gray-200 bg-white text-gray-500 hover:bg-gray-100"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">
                  <th
                    className="cursor-pointer px-5 py-3 hover:text-gray-700"
                    onClick={() => handleSort("name")}
                  >
                    Fabric <SortIcon active={sortKey === "name"} />
                  </th>
                  <th className="px-5 py-3 text-right">Rate</th>
                  <th
                    className="cursor-pointer px-5 py-3 text-right hover:text-gray-700"
                    onClick={() => handleSort("totalStock")}
                  >
                    Metres{" "}
                    <SortIcon active={sortKey === "totalStock"} />
                  </th>
                  <th className="px-5 py-3 text-center">Colours</th>
                  <th
                    className="cursor-pointer px-5 py-3 text-right hover:text-gray-700"
                    onClick={() => handleSort("totalValue")}
                  >
                    Stock Value <SortIcon active={sortKey === "totalValue"} />
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-50">
                {sortedItems.map((item, idx) => {
                  const soldOut =
                    item.outOfStockVariants === item.variantCount &&
                    item.variantCount > 0;

                  return (
                    <tr
                      key={item.id}
                      className={`transition-colors hover:bg-gray-50 ${
                        idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"
                      }`}
                    >
                      <td className="px-5 py-3.5 font-mono font-semibold text-gray-800">
                        {item.name}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-gray-600">
                        ₹{item.pricePerMeter.toLocaleString("en-IN")}/m
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-gray-700">
                        {formatMeters(item.totalStock)}
                        {soldOut && (
                          <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-600">
                            sold out
                          </span>
                        )}
                        {!soldOut && item.lowStockVariants > 0 && (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                            {item.lowStockVariants} low
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-center text-gray-500">
                        {item.variantCount}
                      </td>
                      <td className="px-5 py-3.5 text-right font-bold tabular-nums text-gray-900">
                        {formatCurrency(item.totalValue)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                  <td className="px-5 py-3.5 text-gray-700" colSpan={2}>
                    Total ({sortedItems.length} fabrics)
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-gray-800">
                    {formatMeters(filteredTotals.stock)}
                  </td>
                  <td className="px-5 py-3.5 text-center tabular-nums text-gray-800" />
                  <td className="px-5 py-3.5 text-right tabular-nums text-gray-900">
                    {formatCurrency(filteredTotals.value)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <p className="mt-6 text-xs text-gray-400">
          Stock value is physical metres on the rolls × the fabric&apos;s rate per
          metre. Outstanding order demand and packed-but-undispatched metres are
          not deducted here.
        </p>
      </div>
    </div>
  );
};

export default Summary;
