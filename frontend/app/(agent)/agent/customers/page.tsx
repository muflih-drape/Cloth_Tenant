"use client";

import { useAuth } from "@/context/AuthContext";
import { Info, ArrowLeft, Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CustomerAllResponse } from "@/types/customer";
import { customerApi } from "@/lib/api/customer";
import { PaginatedResponse } from "@/types/global";
import { PageLoading } from "@/components/ui/Loading";
import StockflowAvatar from "@/components/ui/custom/stockflowAvatar";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import Pagination from "@/components/ui/Pagination";

export default function AgentCustomersPage() {
  const { isAuthenticated } = useAuth();
  const [data, setData] = useState<CustomerAllResponse>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!isAuthenticated) return;
    setLoading(true);
    const fetchData = async () => {
      try {
        const response: PaginatedResponse<CustomerAllResponse[number]> =
          await customerApi.getAll({
            page: currentPage,
            page_size: pageSize,
            search: debouncedSearch,
          });
        setData(response.results);
        setTotalCount(response.count);
        setTotalPages(Math.ceil(response.count / pageSize));
      } catch (error) {
        console.error("Error fetching customers:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [isAuthenticated, currentPage, pageSize, debouncedSearch]);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  return (
    <div className="min-h-screen bg-gray-50/50 pb-20">
      {/* Header */}
      <div className="flex justify-between mx-auto items-center bg-white border-b border-gray-100 sticky top-0 z-10 pb-2">
        <div className="flex justify-start items-center gap-4">
          <button
            onClick={() => router.push("/agent/profile")}
            className="p-2 rounded-xl hover:bg-gray-50 text-gray-400 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex flex-col">
            <h1 className="text-xl font-black text-gray-900 leading-tight">
              My Customers
            </h1>
            <div className="flex gap-2 items-center mt-1">
              <span className="text-gray-400 text-[10px] font-bold uppercase tracking-wider">
                Total Linked
              </span>
              <div className="flex bg-primary/10 text-primary rounded-full w-8 h-8 items-center justify-center border border-primary/20">
                <span className="font-bold text-xs">{totalCount}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto pt-6">
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
        ) : data.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-300">
            <Info size={40} className="mb-4 opacity-20" />
            <h2 className="text-xl font-bold">No Customers Found</h2>
            <p className="text-sm text-gray-400 mt-1">You customers yet.</p>
            <div className="flex justify-center items-center p-4">
              <StockFlowButton
                text="Add Customer"
                variant="filled"
                icon={<Plus className="size-4" />}
                onClick={() => router.push("/agent/customers/new")}
                className="shadow-lg shadow-primary/20 ring-1 ring-primary/10"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3 pb-10">
            <div className="flex justify-end">
              <StockFlowButton
                text="Add Customer"
                variant="filled"
                icon={<Plus className="size-4" />}
                onClick={() => router.push("/agent/customers/new")}
                className="shadow-lg shadow-primary/20 ring-1 ring-primary/10"
              />
            </div>
            {data.map((item) => (
              <div
                key={item.id}
                onClick={() => router.push(`/agent/customers/${item.id}`)}
                className="flex items-center gap-4 bg-white border border-gray-100 p-4 hover:border-primary/30 hover:shadow-md transition-all rounded-2xl group active:scale-[0.98]"
              >
                <StockflowAvatar user={item} />

                <div className="flex-1 min-w-0">
                  <h6 className="font-bold text-gray-900 text-sm">
                    {item.name}
                  </h6>
                  <p className="text-xs text-gray-400 truncate mt-1 leading-tight font-medium">
                    {item.address || "No address provided"}
                  </p>
                </div>

                <div className="flex flex-col items-end justify-center px-4 border-l border-gray-50">
                  <span className="text-[10px] text-gray-300 font-bold uppercase tracking-widest mb-1">
                    Orders
                  </span>
                  <span className="text-lg font-black leading-none text-gray-900">
                    {item.total_orders}
                  </span>
                </div>

                <div className="text-gray-200 group-hover:text-primary/30 transition-colors pl-2">
                  <Info size={18} />
                </div>
              </div>
            ))}
          </div>
        )}
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={pageSize}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
        />
      </div>
    </div>
  );
}
