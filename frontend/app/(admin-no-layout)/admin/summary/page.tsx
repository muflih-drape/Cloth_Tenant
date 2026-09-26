"use client";

import React, { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { itemApi } from "@/lib/api/item";
import { UIItem } from "@/types/item";
import { ItemStockEntry } from "@/types/item";
import { ArrowBigLeft } from "lucide-react";

export const SIZE_RANGE_PIECE_COUNT: Record<string, number> = {
  "20-38": 10,
  "20-36": 9,
  "26-38": 7,
  "20-30": 6,
  "26-36": 6,
  "32-38": 4,
  "32-36": 3,
  "S,M,L,XL,XXL": 5,
  "S,M,L,XL": 4,
  "M,L,XL,XXL": 4,
  "M,L,XL": 3,
};

const SINGLE_SIZE_PIECE_COUNT: Record<string, number> = {
  S: 1,
  M: 1,
  L: 1,
  XL: 1,
  XXL: 1,
  "38": 1,
  "32-36": 3,
  "26-30": 3,
  "20-24": 3,
};

function getPieceCount(sizeRange: string): number {
  if (SIZE_RANGE_PIECE_COUNT[sizeRange] !== undefined) {
    return SIZE_RANGE_PIECE_COUNT[sizeRange];
  }
  if (SINGLE_SIZE_PIECE_COUNT[sizeRange] !== undefined) {
    return SINGLE_SIZE_PIECE_COUNT[sizeRange];
  }
  return sizeRange.split(",").length;
}

interface ItemSummary {
  id: number;
  name: string;
  type: string;
  price: string;
  variantCount: number;
  totalStock: number;
  totalUnits: number;
  totalPrice: number; // totalUnits × price
}

interface ComputedSummary {
  totalStock: number;
  totalUnits: number;
  totalPrice: number;
  gentsStock: number;
  gentsUnits: number;
  gentsPrice: number;
  kidsStock: number;
  kidsUnits: number;
  kidsPrice: number;
  itemSummaries: ItemSummary[];
}

function normalizeAdminItem(item: ItemStockEntry): UIItem {
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    price: item.price,
    variants: item.variants.map((v) => ({
      id: v.id,
      image: v.image,
      qr_code: v.qr_code,
      sizes: v.sizes,
    })),
  };
}

// Only the part before a "-" is used for sorting purposes.
// e.g. "1040-02" sorts as "1040".
function getSortName(name: string): string {
  return name.split("-")[0];
}

function computeSummary(items: UIItem[]): ComputedSummary {
  let totalStock = 0;
  let totalUnits = 0;
  let totalPrice = 0;
  let gentsStock = 0;
  let gentsUnits = 0;
  let gentsPrice = 0;
  let kidsStock = 0;
  let kidsUnits = 0;
  let kidsPrice = 0;

  const itemSummaries: ItemSummary[] = items.map((item) => {
    let itemStock = 0;
    let itemUnits = 0;
    const unitPrice = parseFloat(item.price);

    for (const variant of item.variants) {
      for (const sizeEntry of variant.sizes) {
        const pieces = getPieceCount(sizeEntry.size_range);
        itemStock += sizeEntry.stock;
        itemUnits += sizeEntry.stock * pieces;
      }
    }

    const itemPrice = itemUnits * unitPrice;

    totalStock += itemStock;
    totalUnits += itemUnits;
    totalPrice += itemPrice;

    if (item.type === "gents") {
      gentsStock += itemStock;
      gentsUnits += itemUnits;
      gentsPrice += itemPrice;
    } else if (item.type === "kids") {
      kidsStock += itemStock;
      kidsUnits += itemUnits;
      kidsPrice += itemPrice;
    }

    return {
      id: item.id,
      name: item.name,
      type: item.type,
      price: item.price,
      variantCount: item.variants.length,
      totalStock: itemStock,
      totalUnits: itemUnits,
      totalPrice: itemPrice,
    };
  });

  return {
    totalStock,
    totalUnits,
    totalPrice,
    gentsStock,
    gentsUnits,
    gentsPrice,
    kidsStock,
    kidsUnits,
    kidsPrice,
    itemSummaries,
  };
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function StatCard({
  label,
  stock,
  units,
  price,
}: {
  label: string;
  stock: number;
  units: number;
  price: number;
}) {
  const avg = stock > 0 ? (units / stock).toFixed(1) : "0";

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gray-400">
        {label}
      </p>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-4xl font-bold tabular-nums text-gray-900">
            {stock.toLocaleString()}
          </p>
          <p className="mt-1 text-sm text-gray-500">stock sets</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold tabular-nums text-gray-900">
            {units.toLocaleString()}
          </p>
          <p className="mt-1 text-sm text-gray-500">total units</p>
        </div>
      </div>
      {/* Total Price row */}
      <div className="mt-4 rounded-lg bg-gray-50 px-3 py-2 flex items-center justify-between">
        <span className="text-xs text-gray-400 font-medium">Total Value</span>
        <span className="text-sm font-bold tabular-nums text-gray-800">
          {formatCurrency(price)}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="h-1.5 flex-1 rounded-full bg-gray-100">
          <div
            className="h-1.5 rounded-full bg-black"
            style={{
              width: `${Math.min(100, parseFloat(avg) * 10)}%`,
              opacity: 0.35,
            }}
          />
        </div>
        <span className="text-xs tabular-nums text-gray-400">
          ×{avg} avg pcs/set
        </span>
      </div>
    </div>
  );
}

type SortKey = "name" | "type" | "totalUnits" | "totalPrice";
type TypeFilter = "all" | "gents" | "kids";

function SortIcon({ active, asc }: { active: boolean; asc: boolean }) {
  return (
    <span className={`ml-1 ${active ? "opacity-70" : "opacity-20"}`}>
      {active ? (asc ? "" : "") : ""}
    </span>
  );
}

const Summary: React.FC = () => {
  const { isAuthenticated, business } = useAuth();
  const router = useRouter();

  const [data, setData] = useState<UIItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const fetchData = useCallback(async () => {
    try {
      const result = await itemApi.getStockList();
      setData(result.map(normalizeAdminItem));
    } catch (e) {
      console.error("Error fetching items:", e);
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

  const summary = useMemo(() => computeSummary(data), [data]);

  const sortedItems = useMemo(() => {
    const filtered = (
      typeFilter === "all"
        ? summary.itemSummaries
        : summary.itemSummaries.filter((i) => i.type === typeFilter)
    ).filter((i) => i.totalStock !== 0); // hide items with zero stock sets

    return [...filtered].sort((a, b) => {
      if (sortKey === "name") {
        const an = getSortName(a.name);
        const bn = getSortName(b.name);
        const cmp = an.localeCompare(bn, undefined, { numeric: true });
        return sortAsc ? cmp : -cmp;
      }

      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortAsc
        ? (av as number) - (bv as number)
        : (bv as number) - (av as number);
    });
  }, [summary, sortKey, sortAsc, typeFilter]);

  const filteredTotals = useMemo(
    () => ({
      stock: sortedItems.reduce((s, i) => s + i.totalStock, 0),
      units: sortedItems.reduce((s, i) => s + i.totalUnits, 0),
      price: sortedItems.reduce((s, i) => s + i.totalPrice, 0),
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

  // Dedicated toggle for the "Total Pieces: Low → High" filter button
  const isUnitsAscActive = sortKey === "totalUnits" && sortAsc;
  const toggleUnitsAscFilter = () => {
    if (isUnitsAscActive) {
      // turn it off, go back to default name sort
      setSortKey("name");
      setSortAsc(false);
    } else {
      setSortKey("totalUnits");
      setSortAsc(true);
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
        </div>

        {/* Stat Cards */}
        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          {business != "kids" && business != "gents" && (
            <StatCard
              label="All Items"
              stock={summary.totalStock}
              units={summary.totalUnits}
              price={summary.totalPrice}
            />
          )}
          {business != "kids" && (
            <StatCard
              label="Gents"
              stock={summary.gentsStock}
              units={summary.gentsUnits}
              price={summary.gentsPrice}
            />
          )}
          {business != "gents" && (
            <StatCard
              label="Kids"
              stock={summary.kidsStock}
              units={summary.kidsUnits}
              price={summary.kidsPrice}
            />
          )}
        </div>

        {/* Table Controls */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-500">
            Per-Item Breakdown
          </h2>
          <div className="flex flex-wrap gap-2">
            {/* Total pieces ascending filter button */}
            <button
              onClick={toggleUnitsAscFilter}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                isUnitsAscActive
                  ? "bg-black text-white"
                  : "border border-gray-200 bg-white text-gray-500 hover:bg-gray-100"
              }`}
            >
              Total Pieces: Low → High
            </button>

            {business != "kids" &&
              business != "gents" &&
              (["all", "gents", "kids"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors ${
                    typeFilter === t
                      ? "bg-black text-white"
                      : "border border-gray-200 bg-white text-gray-500 hover:bg-gray-100"
                  }`}
                >
                  {t}
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
                    Item <SortIcon active={sortKey === "name"} asc={sortAsc} />
                  </th>
                  <th
                    className="cursor-pointer px-5 py-3 hover:text-gray-700"
                    onClick={() => handleSort("type")}
                  >
                    Type <SortIcon active={sortKey === "type"} asc={sortAsc} />
                  </th>
                  <th
                    className="cursor-pointer px-5 py-3 text-right hover:text-gray-700"
                    onClick={() => handleSort("totalUnits")}
                  >
                    Total Pieces{" "}
                    <SortIcon active={sortKey === "totalUnits"} asc={sortAsc} />
                  </th>
                  <th className="px-5 py-3 text-center">Variants</th>
                  <th
                    className="cursor-pointer px-5 py-3 text-right hover:text-gray-700"
                    onClick={() => handleSort("totalPrice")}
                  >
                    Total Value{" "}
                    <SortIcon active={sortKey === "totalPrice"} asc={sortAsc} />
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-50">
                {sortedItems.map((item, idx) => {
                  const typeColor =
                    item.type === "gents"
                      ? "bg-sky-100 text-sky-700"
                      : "bg-amber-100 text-amber-700";

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
                      <td className="px-5 py-3.5">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${typeColor}`}
                        >
                          {item.type}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-gray-700">
                        {item.totalUnits.toLocaleString()}
                      </td>
                      <td className="px-5 py-3.5 text-center text-gray-500">
                        {item.variantCount}
                      </td>
                      <td className="px-5 py-3.5 text-right font-bold tabular-nums text-gray-900">
                        {formatCurrency(item.totalPrice)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                  <td className="px-5 py-3.5 text-gray-700" colSpan={2}>
                    Total ({sortedItems.length} items)
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-gray-800">
                    {filteredTotals.units.toLocaleString()}
                  </td>
                  <td className="px-5 py-3.5 text-center tabular-nums text-gray-800" />
                  <td className="px-5 py-3.5 text-right tabular-nums text-gray-900">
                    {formatCurrency(filteredTotals.price)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Size Range Legend */}
        <div className="mt-6 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-400">
            Size Range → Piece Count Reference
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(SIZE_RANGE_PIECE_COUNT).map(([range, count]) => (
              <span
                key={range}
                className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-1 font-mono text-xs text-gray-600"
              >
                <span className="font-semibold text-black">{range}</span> →{" "}
                {count} pcs
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Summary;
