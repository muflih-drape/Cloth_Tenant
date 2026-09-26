"use client";

import { useEffect, useState } from "react";
import { orderApi } from "@/lib/api/order";
import { toastError } from "@/lib/toast";
import { OrderAllResponse } from "@/types/order";
import { PageLoading } from "@/components/ui/Loading";
import { useRouter } from "next/navigation";
import OrderCard from "@/components/pages/agent/order/OrderCard";
import OrderListHeader from "@/components/pages/agent/order/OrderListHeader";
import EmptyState from "@/components/ui/EmptyState";
import FilterBar from "@/components/ui/FilterBar";
import FilterToggle from "@/components/ui/FilterToggle";
import SearchBar from "@/components/ui/SearchBar";
import Pagination from "@/components/ui/Pagination";
import useSessionStorage from "@/hooks/useSessionStorage";
import { PaginatedResponse } from "@/types/global";

type ItemTypeTab = "all" | "gents" | "kids";

interface AgentOrderListProps {
  pageOrderStatus?: "PROCESSING" | "COMPLETED";
}

export default function AgentOrderList({
  pageOrderStatus = "PROCESSING",
}: AgentOrderListProps) {
  const [data, setData] = useState<OrderAllResponse>([]);
  const [loadError, setLoadError] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useSessionStorage("agent_search", "");
  const [selectedCustomer, setSelectedCustomer] = useSessionStorage(
    "agent_selectedCustomer",
    "all",
  );
  const [currentPage, setCurrentPage] = useSessionStorage(
    "agent_currentPage",
    1,
  );
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useSessionStorage("agent_pageSize", 50);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [loading, setLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [activeTab, setActiveTab] = useSessionStorage<ItemTypeTab>(
    "agent_itemTypeTab",
    "all",
  );

  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setIsFetching(true);
    const fetchData = async () => {
      try {
        const response: PaginatedResponse<OrderAllResponse[number]> =
          await orderApi.getAll({
            from: fromDate || undefined,
            to: toDate || undefined,
            page: currentPage,
            page_size: pageSize,
            search: debouncedSearch,
            status:
              pageOrderStatus === "PROCESSING"
                ? ["PENDING", "PACKED", "DRAFT"]
                : ["DISPATCHED"],
            customer: selectedCustomer !== "all" ? selectedCustomer : undefined,
          });
        setData(response.results);
        setTotalCount(response.count);
        setTotalPages(Math.ceil(response.count / pageSize));
      } catch (e) {
        console.error("Error fetching orders:", e);
        toastError("Failed to fetch orders", e);
        setLoadError(true);
      } finally {
        setIsFetching(false);
        setLoading(false);
      }
    };
    fetchData();
  }, [
    fromDate,
    toDate,
    currentPage,
    pageSize,
    pageOrderStatus,
    debouncedSearch,
    selectedCustomer,
  ]);

  const sortedData = [...data]
    .filter((order) => order.status !== "DRAFT" || order.items.length > 0)
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

  // Client-side filter by active tab — same logic as Home page
  const filteredData =
    activeTab === "all"
      ? sortedData
      : sortedData.filter((order) =>
          order.items.some((item) => item.item_type === activeTab),
        );

  const order_len = filteredData.length;

  const handleClearFilters = () => {
    setFromDate("");
    setToDate("");
    setSelectedCustomer("all");
    setSearch("");
    setShowFilters(false);
    setCurrentPage(1);
  };

  const handleToggleFilters = () => {
    if (showFilters) {
      handleClearFilters();
    } else {
      setShowFilters(true);
    }
  };

  const handleTabChange = (tab: ItemTypeTab) => {
    setActiveTab(tab);
    sessionStorage.removeItem("agent_scrollY");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  useEffect(() => {
    const saved = sessionStorage.getItem("agent_scrollY");
    if (saved) setTimeout(() => window.scrollTo(0, parseInt(saved)), 0);

    let timeout: NodeJS.Timeout;
    const saveScroll = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        sessionStorage.setItem("agent_scrollY", window.scrollY.toString());
      }, 100);
    };

    window.addEventListener("scroll", saveScroll);
    return () => {
      window.removeEventListener("scroll", saveScroll);
      clearTimeout(timeout);
    };
  }, []);

  if (loading) return <PageLoading />;
  if (loadError) return null;

  return (
    <div className="min-h-screen min-w-full">
      <OrderListHeader
        title="Remaining Orders"
        count={order_len}
        showFilters={showFilters}
        handleToggleFilters={handleToggleFilters}
        pageIndicator={
          currentPage > 1 ? (
            <div className="flex items-center gap-1 xs:gap-2">
              <p className="text-gray-400 font-medium text-xs whitespace-nowrap">
                Viewing page {currentPage}
              </p>
              <button
                onClick={() => {
                  setCurrentPage(1);
                  sessionStorage.removeItem("agent_scrollY");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="text-[10px] px-2 py-0.5 bg-primary/10 text-primary rounded-full hover:bg-primary/20 transition-colors whitespace-nowrap"
                title="Reset to page 1"
              >
                Reset to page 1
              </button>
            </div>
          ) : undefined
        }
      />

      <div className="flex gap-4 mb-4">
        <SearchBar
          value={search}
          isLoading={isFetching}
          onChange={(val) => {
            setSearch(val);
            setCurrentPage(1);
          }}
          placeholder="Search by customer or order ID..."
        />
        {showFilters !== undefined && handleToggleFilters && (
          <FilterToggle isOpen={showFilters} onToggle={handleToggleFilters} />
        )}
      </div>

      <FilterBar
        fromDate={fromDate}
        toDate={toDate}
        onFromDateChange={(date) => {
          setFromDate(date);
          setCurrentPage(1);
        }}
        onToDateChange={(date) => {
          setToDate(date);
          setCurrentPage(1);
        }}
        selectedCustomer={selectedCustomer}
        onCustomerChange={(val) => {
          setSelectedCustomer(val);
          setCurrentPage(1);
        }}
        isOpen={showFilters}
        onClear={handleClearFilters}
        tabs={[
          { value: "all", label: "All" },
          { value: "gents", label: "Gents" },
          { value: "kids", label: "Kids" },
        ]}
        activeTab={activeTab}
        onTabChange={(tab) => handleTabChange(tab as ItemTypeTab)}
      />

      {order_len === 0 ? (
        <EmptyState
          title={
            search || selectedCustomer !== "all"
              ? "No matching orders"
              : "No Active Orders"
          }
        />
      ) : (
        <div className="space-y-3 pb-32">
          {filteredData.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              onClick={() => {
                if (order.status == "DRAFT") {
                  router.push(`/agent/order/new/${order.customer_details.id}`);
                } else {
                  router.push(`/agent/order/status/${order.id}`);
                }
              }}
            />
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
  );
}
