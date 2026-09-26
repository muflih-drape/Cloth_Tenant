"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AxiosError } from "axios";
import { ArrowLeft, ArrowRight, MapPin, Plus, Search, User } from "lucide-react";
import { customerApi } from "@/lib/api/customer";
import { orderApi } from "@/lib/api/order";
import { buildOrderCreatePayload, extractErrorMessage } from "@/lib/orderFlow";
import { toastError } from "@/lib/toast";
import type { CustomerAllResponse } from "@/types/customer";
import { PageLoading } from "@/components/ui/Loading";
import StockflowAvatar from "@/components/ui/custom/stockflowAvatar";

const PAGE_SIZE = 20;

export default function AdminCustomerSelect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetCustomerId = searchParams.get("customer");

  const [customers, setCustomers] = useState<CustomerAllResponse>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const [presetCustomer, setPresetCustomer] = useState<
    CustomerAllResponse[number] | null
  >(null);
  const creatingRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    const append = page > 1;

    const load = async () => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const res = await customerApi.getAll({
          page,
          page_size: PAGE_SIZE,
          search: debouncedSearch,
        });
        if (cancelled) return;
        setCustomers((prev) =>
          append ? [...prev, ...res.results] : res.results,
        );
        setTotalCount(res.count);
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        toastError("Failed to load customers");
      } finally {
        if (cancelled) return;
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    };

    const timer = setTimeout(load, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [page, debouncedSearch]);

  useEffect(() => {
    if (!presetCustomerId) return;
    customerApi
      .getOne(Number(presetCustomerId))
      .then(setPresetCustomer)
      .catch(console.error);
  }, [presetCustomerId]);

  const handleSelect = async (customerId: number, agentId: number) => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      const res = await orderApi.create(
        buildOrderCreatePayload(customerId, agentId),
      );
      if (res.id) localStorage.setItem("orderKey", String(res.id));
      router.push(`/admin/order/new/${customerId}`);
    } catch (error) {
      const axiosError = error as AxiosError;
      toastError(
        extractErrorMessage(
          axiosError.response?.data,
          "Failed to create order",
        ),
      );
      creatingRef.current = false;
      setCreating(false);
    }
  };

  const hasMore = customers.length < totalCount;

  return (
    <div className="min-h-screen bg-gray-50/50 pb-32">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-6 sticky top-0 z-10">
        <div className="max-w-md mx-auto flex items-center gap-4">
          <button
            onClick={() => router.push("/admin")}
            className="p-2 rounded-xl hover:bg-gray-50 text-gray-400 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex flex-col">
            <h1 className="text-xl font-black text-gray-900 leading-tight">
              Create Order
            </h1>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
              Step 1: Select Customer
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto py-6 px-6">
        {/* Preselected customer */}
        {presetCustomer && (
          <button
            onClick={() => handleSelect(presetCustomer.id, presetCustomer.agent)}
            disabled={creating}
            className="w-full mb-4 flex items-center gap-4 bg-primary/5 border border-primary/20 p-4 rounded-3xl text-left hover:border-primary/40 hover:shadow-md transition-all active:scale-[0.98] disabled:opacity-60"
          >
            <StockflowAvatar user={presetCustomer} />
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-black uppercase tracking-widest text-primary/60">
                Continue with
              </p>
              <h6 className="font-semibold text-gray-900 text-sm truncate">
                {presetCustomer.name}
              </h6>
              <p className="text-xs text-gray-400 truncate">
                Agent: {presetCustomer.agent_name || "—"}
              </p>
            </div>
            <div className="text-primary/50">
              <ArrowRight size={20} />
            </div>
          </button>
        )}

        {/* Search Bar */}
        <div className="relative mb-4">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-gray-400">
            <Search size={18} />
          </div>
          <input
            type="text"
            placeholder="Search customer..."
            className="w-full bg-white border border-gray-100 rounded-2xl py-3 pl-12 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all shadow-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {loading ? (
          <PageLoading />
        ) : customers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-300">
            <User size={40} className="mb-4 opacity-20" />
            <h2 className="text-xl font-bold">No Customers Found</h2>
          </div>
        ) : (
          <div className="space-y-3">
            {customers.map((customer) => (
              <button
                onClick={() => handleSelect(customer.id, customer.agent)}
                key={customer.id}
                disabled={creating}
                className="flex w-full items-center gap-4 bg-white border border-gray-100 p-4 hover:border-primary/30 hover:shadow-md transition-all rounded-3xl group text-left active:scale-[0.98] disabled:opacity-60"
              >
                <StockflowAvatar user={customer} />
                <div className="flex-1 min-w-0">
                  <h6 className="font-semibold text-gray-900 text-sm">
                    {customer.name}
                  </h6>
                  <div className="flex items-center gap-1 mt-1">
                    <User size={10} className="text-gray-300" />
                    <p className="text-xs text-gray-400 truncate leading-tight font-medium">
                      Agent: {customer.agent_name || "—"}
                    </p>
                  </div>
                  {customer.address && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <MapPin size={10} className="text-gray-300" />
                      <p className="text-xs text-gray-400 truncate leading-tight font-medium">
                        {customer.address}
                      </p>
                    </div>
                  )}
                </div>
                <div className="text-gray-200 group-hover:text-primary/40 transition-colors">
                  <ArrowRight size={20} />
                </div>
              </button>
            ))}

            {hasMore && (
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={loadingMore}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-gray-200 text-gray-600 font-bold text-sm hover:bg-gray-100 transition-colors disabled:opacity-60"
              >
                {loadingMore ? (
                  <span className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                ) : (
                  <Plus size={16} />
                )}
                Show more
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
