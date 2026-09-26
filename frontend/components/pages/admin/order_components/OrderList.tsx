"use client";
import { useAuth } from "@/context/AuthContext";
import { orderApi } from "@/lib/api/order";
import { OrderAllResponse } from "@/types/order";
import { Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { OrderCard } from "@/components/order";
import { OrderFilters } from "./types";
import {
    markOrderAsViewed,
    getUnreadIds,
    fetchViewedOrderIds,
    clearViewedCache,
} from "@/lib/viewedOrders";
import Pagination from "@/components/ui/Pagination";
import useSessionStorage from "@/hooks/useSessionStorage";
import { PaginatedResponse } from "@/types/global";
import { PageLoading } from "@/components/ui/Loading";

type OrderStatus = "ALL" | "PENDING" | "PACKED" | "DISPATCHED";

interface Props {
    status: OrderStatus;
    filters?: OrderFilters;
    search?: string;
    showUnreadOnly?: boolean;
    refreshKey?: number;
    onTotalCountChange?: (total: number) => void;
    onPageChange?: (page: number) => void;
}

const LABELS: Record<OrderStatus, string> = {
    ALL: "orders",
    PENDING: "pending orders",
    PACKED: "packed orders",
    DISPATCHED: "dispatched orders",
};

const EMPTY_LABELS: Record<OrderStatus, string> = {
    ALL: "No Data Found",
    PENDING: "No Pending Orders",
    PACKED: "No Packed Orders",
    DISPATCHED: "No Dispatched Orders",
};

const OrderList: React.FC<Props> = ({
    status,
    filters,
    search,
    showUnreadOnly,
    refreshKey,
    onTotalCountChange,
    onPageChange,
}) => {
    const { isAuthenticated } = useAuth();
    const router = useRouter();
    const key = status.charAt(0) + status.slice(1).toLowerCase(); // "All", "Pending", etc.

    const [data, setData] = useState<OrderAllResponse>([]);
    const [loading, setLoading] = useState(true);
    const [currentPage, setCurrentPage] = useSessionStorage(
        `admin_${key}_currentPage`,
        1,
    );
    const [totalCount, setTotalCount] = useState(0);
    const [totalPages, setTotalPages] = useState(1);
    const [pageSize, setPageSize] = useSessionStorage(
        `admin_${key}_pageSize`,
        50,
    );
    const [viewedIds, setViewedIds] = useState<Set<number>>(new Set());

    useEffect(() => {
        fetchViewedOrderIds().then(setViewedIds).catch(console.error);
        return () => clearViewedCache();
    }, []);

    useEffect(() => {
        setLoading(true);
        const fetchData = async () => {
            try {
                const response: PaginatedResponse<OrderAllResponse[number]> =
                    await orderApi.getAll({
                        ...filters,
                        page: currentPage,
                        page_size: pageSize,
                        search,
                        status: status === "ALL" ? [] : [status],
                    });

                const results = response.results.filter(
                    (order) => order.status != "DRAFT",
                );

                setData(results);
                setTotalCount(response.count);
                setTotalPages(Math.ceil(response.count / pageSize));
                onTotalCountChange?.(
                    showUnreadOnly
                        ? getUnreadIds(
                              results
                                  .filter((o) => o.status !== "DISPATCHED")
                                  .map((o) => o.id),
                              viewedIds,
                          ).length
                        : response.count,
                );
            } catch (error) {
                console.error("Error fetching data:", error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [
        isAuthenticated,
        router,
        filters,
        search,
        viewedIds,
        currentPage,
        pageSize,
        refreshKey,
        showUnreadOnly,
        onTotalCountChange,
        status,
    ]);

    // Restore and save scroll position
    useEffect(() => {
        const saved = sessionStorage.getItem(`admin_${key}_scrollY`);
        if (saved) setTimeout(() => window.scrollTo(0, parseInt(saved)), 0);
        let timeout: NodeJS.Timeout;
        const saveScroll = () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                sessionStorage.setItem(
                    `admin_${key}_scrollY`,
                    window.scrollY.toString(),
                );
            }, 100);
        };
        window.addEventListener("scroll", saveScroll);
        return () => {
            window.removeEventListener("scroll", saveScroll);
            clearTimeout(timeout);
        };
    }, [key]);

    const filtered = showUnreadOnly
        ? data.filter(
              (o) =>
                  o.status !== "DISPATCHED" &&
                  getUnreadIds([o.id], viewedIds).length > 0,
          )
        : data;

    const handlePageChange = (page: number) => {
        setCurrentPage(page);
        window.scrollTo({ top: 0, behavior: "smooth" });
        onPageChange?.(page);
    };

    const handlePageSizeChange = (size: number) => {
        setPageSize(size);
        setCurrentPage(1);
    };

    if (loading) return <PageLoading text={`Loading ${LABELS[status]}...`} />;

    if (filtered.length === 0)
        return (
            <div className="flex flex-col items-center justify-center py-20 text-gray-300">
                <Info size={40} className="mb-4 opacity-20" />
                <h2 className="text-xl font-bold">
                    {showUnreadOnly
                        ? "No unread orders"
                        : search
                          ? "No matching orders"
                          : EMPTY_LABELS[status]}
                </h2>
            </div>
        );

    return (
        <div className="space-y-3 pb-20">
            {filtered.map((order) => (
                <OrderCard
                    key={`${order.id}-${refreshKey}`}
                    order={order}
                    viewed={
                        order.status === "DISPATCHED"
                            ? true
                            : viewedIds.has(order.id)
                    }
                    onClick={() => {
                        markOrderAsViewed(order.id);
                        router.push(`/admin/order/status/${order.id}`);
                    }}
                />
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
    );
};

export default OrderList;
