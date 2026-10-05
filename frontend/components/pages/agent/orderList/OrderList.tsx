"use client";

import { useEffect, useState } from "react";
import { orderApi } from "@/lib/api/order";
import { toastError } from "@/lib/toast";
import { OrderAllResponse } from "@/types/order";
import { outstandingMeters } from "@/lib/utils/orderItemSort";
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

type PackingTab = "all" | "awaiting" | "ready";

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
  const [activeTab, setActiveTab] = useSessionStorage<PackingTab>(
    "agent_packingTab",
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
                // Still being worked on. PARTIALLY_DISPATCHED is in here because
                // such an order still owes cloth and still has sealed bundles
                // waiting to go out, so an agent may well need to see it.
                ? ["PENDING", "PACKED", "DRAFT", "PARTIALLY_DISPATCHED"]
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
  // Cloth moves through the warehouse before it ships, so the useful split is
  // "is any metre still waiting to be packed" rather than a product category.
  // An order with no lines has no packing state at all, so it belongs to neither
  // bucket: `some()` on an empty list is false, which would otherwise file it
  // under "Fully Packed" and hide it from the agent who has to fix it.
  const filteredData =
    activeTab === "all"
      ? sortedData
      : sortedData.filter((order) => {
          if ((order.items?.length ?? 0) === 0) return false;
          const awaiting = order.items.some(
            (item) => outstandingMeters(item) > 0,
          );
          return activeTab === "awaiting" ? awaiting : !awaiting;
        });

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

  const handleTabChange = (tab: PackingTab) => {
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
          { value: "awaiting", label: "Awaiting Packing" },
          { value: "ready", label: "Fully Packed" },
        ]}
        activeTab={activeTab}
        onTabChange={(tab) => handleTabChange(tab as PackingTab)}
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
                  // The wizard resolves which order to edit from localStorage,
                  // not from the route -- the route only carries the customer.
                  // Point it at this draft so reopening the card cannot land on
                  // whatever order a previous session left behind.
                  localStorage.setItem("orderKey", String(order.id));
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
