"use client";

import { useEffect, useState, Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { agentApi } from "@/lib/api/agents";
import { orderApi } from "@/lib/api/order";
import FilterBar from "@/components/ui/FilterBar";
import FilterToggle from "@/components/ui/FilterToggle";
import SearchBar from "@/components/ui/SearchBar";
import { OrderFilters } from "@/components/pages/admin/order_components/types";
import { fetchViewedOrderIds, getViewedOrdersCount } from "@/lib/viewedOrders";
import useSessionStorage from "@/hooks/useSessionStorage";
import OrderList from "@/components/pages/admin/order_components/OrderList";
import { PageLoading } from "@/components/ui/Loading";

type Tab = "All" | "Packed" | "Pending" | "Dispatched";

interface SimpleAgent {
    id: number;
    username: string;
}

function AdminHomePageContent() {
    const searchParams = useSearchParams();
    const [currentPage, setCurrentPage] = useState(1);

    const [activeTab, setActiveTab] = useState<Tab>("Pending");

    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        const saved = sessionStorage.getItem("adminOrdersActiveTab") as Tab;
        if (saved) setActiveTab(saved);
    }, []);

    const handleTabChange = (tab: Tab) => {
        setActiveTab(tab);
        sessionStorage.setItem("adminOrdersActiveTab", tab);
        setTabPages((prev) => ({ ...prev, [tab]: 1 }));
        setCurrentPage(tabPages[tab] || 1);
        sessionStorage.removeItem(`admin_${tab}_scrollY`);
    };

    const [filters, setFilters] = useSessionStorage<OrderFilters>(
        "admin_filters",
        {},
    );
    const [agents, setAgents] = useState<SimpleAgent[]>([]);
    const [showFilters, setShowFilters] = useState(false);
    const [search, setSearch] = useSessionStorage("admin_search", "");
    const [orderCounts, setOrderCounts] = useState<Record<string, number>>({});
    const [showUnreadOnly, setShowUnreadOnly] = useSessionStorage(
        "admin_showUnreadOnly",
        false,
    );
    const [allOrderIds, setAllOrderIds] = useState<number[]>([]);
    const [pendingOrderIds, setPendingOrderIds] = useState<number[]>([]);
    const [packedOrderIds, setPackedOrderIds] = useState<number[]>([]);
    const [refreshKey, setRefreshKey] = useState(0);
    const [activeTabTotalCount, setActiveTabTotalCount] = useState(0);
    const [viewedOrderIds, setViewedOrderIds] = useState<Set<number>>(
        new Set(),
    );

    const memoFilters = useMemo(() => filters, [JSON.stringify(filters)]);
    const [debouncedSearch, setDebouncedSearch] = useState(search);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
        }, 400);

        return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        agentApi
            .getAll()
            .then((agents) => {
                setAgents(
                    agents.map((a) => ({
                        id: a.id,
                        username: a.user.username,
                    })),
                );
            })
            .catch(console.error);
    }, []);

    useEffect(() => {
        orderApi
            .getAllIds()
            .then((orderIds) => {
                const nonDispatched = orderIds.filter(
                    (o) => o.status !== "DISPATCHED",
                );
                setAllOrderIds(nonDispatched.map((o) => o.id));
                setPendingOrderIds(
                    orderIds
                        .filter((o) => o.status === "PENDING")
                        .map((o) => o.id),
                );
                setPackedOrderIds(
                    orderIds
                        .filter((o) => o.status === "PACKED")
                        .map((o) => o.id),
                );
            })
            .catch(console.error);
    }, []);

    useEffect(() => {
        setOrderCounts({
            all: getViewedOrdersCount(allOrderIds, viewedOrderIds),
            pending: getViewedOrdersCount(pendingOrderIds, viewedOrderIds),
            packed: getViewedOrdersCount(packedOrderIds, viewedOrderIds),
            dispatched: 0,
        });
    }, [allOrderIds, pendingOrderIds, packedOrderIds, viewedOrderIds]);

    useEffect(() => {
        fetchViewedOrderIds().then(setViewedOrderIds).catch(console.error);
    }, []);

    useEffect(() => {
        const customerId = searchParams.get("customer");
        const agentId = searchParams.get("agent");
        const from = searchParams.get("from");
        const to = searchParams.get("to");

        const newFilters: OrderFilters = {};
        if (customerId) newFilters.customer = customerId;
        if (agentId) newFilters.agent = agentId;
        if (from) newFilters.from = from;
        if (to) newFilters.to = to;

        if (Object.keys(newFilters).length > 0) {
            setFilters(newFilters);
            setShowFilters(true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    const handleFromDateChange = (date: string) => {
        setFilters((prev) => ({ ...prev, from: date || undefined }));
    };

    const handleToDateChange = (date: string) => {
        setFilters((prev) => ({ ...prev, to: date || undefined }));
    };

    const handleAgentChange = (agentId: string) => {
        setFilters((prev) => ({
            ...prev,
            agent: agentId === "all" ? undefined : agentId,
        }));
    };

    const handleCustomerChange = (customerId: string) => {
        setFilters((prev) => ({
            ...prev,
            customer: customerId === "all" ? undefined : customerId,
        }));
    };

    const handleClearFilters = () => {
        setFilters({});
        setSearch("");
        setShowFilters(false);
    };

    const handleToggleFilters = () => {
        if (showFilters) {
            handleClearFilters();
        } else {
            setShowFilters(true);
        }
    };

    const [tabPages, setTabPages] = useState<Record<string, number>>({});

    const handleTabPageChange = (tab: string, page: number) => {
        setTabPages((prev) => ({ ...prev, [tab]: page }));
        setCurrentPage(page || 1);
    };

    const renderContent = (): React.ReactNode => {
        const commonProps = {
            filters: memoFilters,
            search: debouncedSearch,
            showUnreadOnly,
            refreshKey,
            onTotalCountChange: setActiveTabTotalCount,
            onPageChange: (page: number) =>
                handleTabPageChange(activeTab, page),
        };

        const statusMap: Record<
            Tab,
            "ALL" | "PENDING" | "PACKED" | "DISPATCHED"
        > = {
            All: "ALL",
            Pending: "PENDING",
            Packed: "PACKED",
            Dispatched: "DISPATCHED",
        };

        return <OrderList status={statusMap[activeTab]} {...commonProps} />;
    };

    const getActiveTabCount = () => {
        return activeTabTotalCount;
    };

    return (
        <div className="min-h-screen min-w-full">
            <div className="p-1.5 mt-2 flex items-center space-x-1 border border-gray-200 rounded-md mb-2 overflow-x-auto">
                {(["All", "Pending", "Packed", "Dispatched"] as Tab[]).map(
                    (tab) => {
                        const count = orderCounts[tab.toLowerCase()];
                        return (
                            <button
                                key={tab}
                                onClick={() => handleTabChange(tab)}
                                className={`shrink-0 rounded-md flex-1 min-w-fit px-3 py-2 font-bold text-xs transition-all duration-300 relative ${
                                    mounted && activeTab === tab
                                        ? "bg-primary text-white ring-1 ring-primary/10"
                                        : "text-gray-500 hover:text-gray-700 hover:bg-gray-100/80"
                                }`}
                            >
                                {tab}
                                {count > 0 && (
                                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[7px] font-bold rounded-full w-4.5 h-4.5 flex items-center justify-center">
                                        {count > 99 ? "99+" : count}
                                    </span>
                                )}
                            </button>
                        );
                    },
                )}
            </div>
            <div className="flex flex-row justify-between items-start sm:items-center gap-2 mt-4 mb-2">
                <div className="flex items-center gap-1">
                    <span className="text-gray-400 text-[10px] font-bold uppercase">
                        {activeTab} {showUnreadOnly && "unread"} Orders
                    </span>
                    <div className=" text-amber-600 flex justify-center items-center">
                        <span className="font-bold text-xs">
                            {getActiveTabCount()}
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <button
                        onClick={() => setShowUnreadOnly(!showUnreadOnly)}
                        className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                            showUnreadOnly
                                ? "bg-primary text-white border-primary shadow-lg shadow-primary/20"
                                : "text-gray-500 border-gray-200 hover:bg-gray-100"
                        }`}
                    >
                        Unread Only
                    </button>
                </div>
            </div>
            <div className="flex items-center justify-between gap-2 mb-4">
                <SearchBar
                    value={search}
                    onChange={(val) => setSearch(val)}
                    placeholder="Search by customer, agent, or order ID..."
                />
                <FilterToggle
                    isOpen={showFilters}
                    onToggle={handleToggleFilters}
                />
            </div>
            <div className="overflow-x-auto mb-4">
                <FilterBar
                    fromDate={filters.from || ""}
                    toDate={filters.to || ""}
                    onFromDateChange={handleFromDateChange}
                    onToDateChange={handleToDateChange}
                    agents={agents}
                    selectedAgent={filters.agent || "all"}
                    onAgentChange={handleAgentChange}
                    selectedCustomer={filters.customer || "all"}
                    onCustomerChange={handleCustomerChange}
                    isOpen={showFilters}
                    onClear={handleClearFilters}
                />
                {currentPage > 1 && (
                    <div className="flex items-center gap-2 mt-2">
                        <p className="text-gray-400 font-medium text-xs">
                            Viewing page {currentPage}
                        </p>
                        <button
                            onClick={() => {
                                setCurrentPage(1);
                                setTabPages({});
                                sessionStorage.removeItem("admin_All_scrollY");
                                sessionStorage.removeItem(
                                    "admin_Pending_scrollY",
                                );
                                sessionStorage.removeItem(
                                    "admin_Packed_scrollY",
                                );
                                sessionStorage.removeItem(
                                    "admin_Dispatched_scrollY",
                                );
                                window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                            className="px-2 py-0.5 bg-primary/10 text-gray-400 font-medium text-xs rounded-full hover:bg-primary/20 transition-colors"
                            title="Go to first page"
                        >
                            Reset to page 1
                        </button>
                    </div>
                )}
            </div>
            <div className="pb-10">{renderContent()}</div>
        </div>
    );
}

export default function AdminHomePage() {
    return (
        <Suspense fallback={<PageLoading />}>
            <AdminHomePageContent />
        </Suspense>
    );
}
