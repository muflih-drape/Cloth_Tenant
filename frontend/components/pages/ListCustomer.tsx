"use client";

import { customerApi } from "@/lib/api/customer";
import { CustomerAllResponse } from "@/types/customer";
import { ArrowRight, MapPin, Search, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PageLoading } from "../ui/Loading";
import { useAuth } from "@/context/AuthContext";
import { agentApi } from "@/lib/api/agents";
import { orderApi } from "@/lib/api/order";
import { toastError } from "@/lib/toast";
import Pagination from "../ui/Pagination";
import { PaginatedResponse } from "@/types/global";
import StockflowAvatar from "../ui/custom/stockflowAvatar";

const CACHE_KEY = "customers_cache";
const CACHE_META_KEY = "customers_cache_meta";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheMeta {
  lastSync: number; // timestamp
  totalCount: number;
}

function readCache(): CustomerAllResponse | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const meta: CacheMeta | null = JSON.parse(
      localStorage.getItem(CACHE_META_KEY) || "null",
    );
    if (!raw || !meta) return null;
    if (Date.now() - meta.lastSync > CACHE_TTL_MS) return null; // expired
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeCache(data: CustomerAllResponse, totalCount: number) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    localStorage.setItem(
      CACHE_META_KEY,
      JSON.stringify({ lastSync: Date.now(), totalCount } satisfies CacheMeta),
    );
  } catch {
    // localStorage full — silently skip caching
  }
}

function clearCache() {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(CACHE_META_KEY);
}

const ListCustomer: React.FC = () => {
  const { user } = useAuth();
  const [data, setData] = useState<CustomerAllResponse>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const router = useRouter();
  const hasMounted = useRef(false);

  const fetchCustomers = async (opts: {
    page: number;
    search: string;
    background?: boolean;
  }) => {
    if (!opts.background) setLoading(true);

    try {
      const response: PaginatedResponse<CustomerAllResponse[number]> =
        await customerApi.getAll({
          page: opts.page,
          page_size: pageSize,
          search: opts.search,
        });

      setData(response.results);
      setTotalCount(response.count);
      setTotalPages(Math.ceil(response.count / pageSize));
      setLastSync(new Date());

      // Only cache page 1 with no search — that's the "default" view
      if (opts.page === 1 && !opts.search) {
        writeCache(response.results, response.count);
      }
    } catch (e) {
      console.error(e);
    } finally {
      if (!opts.background) setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    fetchCustomers({ page: currentPage, search: debouncedSearch });
  }, [currentPage, debouncedSearch]);

  useEffect(() => {
    const cached = readCache();
    if (cached) {
      setData(cached);
      const meta: CacheMeta | null = JSON.parse(
        localStorage.getItem(CACHE_META_KEY) || "null",
      );
      if (meta) {
        setTotalCount(meta.totalCount);
        setTotalPages(Math.ceil(meta.totalCount / pageSize));
        setLastSync(new Date(meta.lastSync));
      }
      setLoading(false);
      fetchCustomers({ page: 1, search: "", background: true });
    } else {
      fetchCustomers({ page: 1, search: "" });
    }
  }, []);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  const handleSubmit = async (id: number) => {
    try {
      setLoading(true);
      router.push(`/agent/order/new/${id}`);
      const res = await agentApi.getProfile(user!.id);
      const res1 = await orderApi.create({
        customer: id,
        status: "DRAFT",
        agent: res.id,
      });
      clearCache(); // order created — customer data may change, bust cache

      if (res1.id) localStorage.setItem("orderKey", String(res1.id));
    } catch {
      toastError("Error creating order. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="py-6 px-6">
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

      {lastSync && (
        <p className="text-[10px] text-gray-300 font-medium mb-3 px-1">
          Last synced {lastSync.toLocaleTimeString()}
        </p>
      )}

      {loading ? (
        <PageLoading />
      ) : data.length == 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-300">
          <User size={40} className="mb-4 opacity-20" />
          <h2 className="text-xl font-bold">No Customers Found</h2>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((customer) => (
            <button
              onClick={() => handleSubmit(customer.id)}
              key={customer.id}
              className="flex w-full items-center gap-4 bg-white border border-gray-100 p-4 hover:border-primary/30 hover:shadow-md transition-all rounded-3xl group text-left active:scale-[0.98]"
            >
              <StockflowAvatar user={customer} />

              <div className="flex-1 min-w-0">
                <h6 className="font-semibold text-gray-900 text-sm ">
                  {customer.name}
                </h6>
                {customer.address && (
                  <div className="flex items-center gap-1 mt-1">
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

          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalCount={totalCount}
            pageSize={pageSize}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
        </div>
      )}
    </div>
  );
};

export default ListCustomer;
