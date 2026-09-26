"use client";

import { Plus, Info } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CustomerAllResponse } from "@/types/customer";
import { customerApi } from "@/lib/api/customer";
import { PaginatedResponse } from "@/types/global";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import StockflowAvatar from "@/components/ui/custom/stockflowAvatar";
import Pagination from "@/components/ui/Pagination";
import { Spinner } from "@/components/ui/spinner";

const CustomerList: React.FC = () => {
    const { isAuthenticated, business } = useAuth();

    const [data, setData] = useState<CustomerAllResponse>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const [totalPages, setTotalPages] = useState(1);
    const [pageSize, setPageSize] = useState(50);

    const router = useRouter();

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
            setCurrentPage(1);
        }, 400);
        return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        // eslint-disable-next-line
        setLoading(true);
        customerApi
            .getAll({
                page: currentPage,
                page_size: pageSize,
                search: debouncedSearch,
            })
            .then(
                (response: PaginatedResponse<CustomerAllResponse[number]>) => {
                    setData(response.results);
                    setTotalCount(response.count);
                    setTotalPages(Math.ceil(response.count / pageSize));
                },
            )
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [isAuthenticated, currentPage, pageSize, debouncedSearch]);

    const handlePageChange = (page: number) => {
        setCurrentPage(page);
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const handlePageSizeChange = (size: number) => {
        setPageSize(size);
        setCurrentPage(1);
    };

    // business filtering is still client-side within the current page
    const businessCustomers = business
        ? data.filter((c) => c.has_business_orders === true)
        : data;
    const otherCustomers = business
        ? data.filter((c) => c.has_business_orders !== true)
        : [];

    const renderSection = (
        customers: typeof data,
        header: string,
        count: number,
    ) => {
        if (customers.length === 0) return null;
        return (
            <>
                <div className="pt-2 flex justify-between items-center px-2 mb-4">
                    <div className="flex flex-col">
                        <div className="flex gap-2 items-center mt-1">
                            <span className="text-gray-400 text-[10px] font-bold uppercase tracking-wider">
                                {header}
                            </span>
                            <div className="bg-primary/10 text-primary rounded-full w-6 h-6 flex items-center justify-center border border-primary/20">
                                <span className="font-bold text-xs">
                                    {count}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="px-0 space-y-3">
                    {customers.map((customer) => (
                        <div
                            key={customer.id}
                            onClick={() =>
                                router.push(
                                    `/admin/users/customers/${customer.id}/`,
                                )
                            }
                            className="flex items-center gap-4 bg-white border border-gray-100 p-4 hover:border-primary/30 hover:shadow-md transition-all rounded-2xl group cursor-pointer active:scale-[0.98]"
                        >
                            <StockflowAvatar user={customer} />

                            <div className="flex-1 min-w-0">
                                <h6 className="font-bold text-gray-900 text-xs">
                                    {customer.name}
                                </h6>
                                <p className="text-xs text-gray-400 truncate mt-1 leading-tight font-medium">
                                    {customer.address || "No address provided"}
                                </p>

                                <div className="flex items-center gap-2 mt-2">
                                    <span className="text-[9px] bg-gray-50 text-gray-500 px-1.5 py-0.5 rounded-md uppercase font-bold tracking-tighter border border-gray-100">
                                        {customer.agent_name}
                                    </span>
                                    <span className="text-[9px] text-gray-300 font-bold uppercase tracking-widest">
                                        Agent
                                    </span>
                                </div>
                            </div>

                            <div className="text-gray-200 group-hover:text-primary/30 transition-colors pl-2">
                                <Info size={18} />
                            </div>
                        </div>
                    ))}
                </div>
            </>
        );
    };

    const searchBar = (
        <div className="relative px-2 mb-4">
            <input
                type="text"
                placeholder="Search customers..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm"
            />
            {loading && <Spinner className="absolute top-1/2 right-2" />}
        </div>
    );

    if (!business) {
        return (
            <>
                <div className="pt-2 flex justify-between items-center px-2 mb-4">
                    <div className="flex flex-col">
                        <h2 className="text-xl font-extrabold text-gray-900 leading-tight">
                            Customers
                        </h2>
                        <div className="flex gap-2 items-center mt-1">
                            <span className="text-gray-400 text-[10px] font-bold uppercase tracking-wider">
                                Total Active
                            </span>
                            <div className="bg-primary/10 text-primary rounded-full py-0.5 px-3 border border-primary/20">
                                <span className="font-bold text-xs">
                                    {totalCount}
                                </span>
                            </div>
                        </div>
                    </div>

                    <StockFlowButton
                        text="Add Customer"
                        variant="filled"
                        icon={<Plus className="size-4" />}
                        onClick={() =>
                            router.push("/admin/users/customers/new")
                        }
                        className="shadow-lg shadow-primary/20 ring-1 ring-primary/10"
                    />
                </div>

                {searchBar}

                {totalCount === 0 && !debouncedSearch ? (
                    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
                        <h2 className="text-xl font-bold text-gray-400">
                            No Customers
                        </h2>
                        <StockFlowButton
                            text="Add Customer"
                            variant="filled"
                            icon={<Plus className="size-4" />}
                            onClick={() =>
                                router.push("/admin/users/customers/new")
                            }
                            className="shadow-lg shadow-primary/20 ring-1 ring-primary/10"
                        />
                    </div>
                ) : data.length === 0 ? (
                    <div className="flex justify-center mt-10">
                        <h2 className="text-gray-400 font-semibold">
                            No matching customers
                        </h2>
                    </div>
                ) : (
                    <div className="px-0 space-y-3 pb-4">
                        {data.map((item) => (
                            <div
                                key={item.id}
                                onClick={() =>
                                    router.push(
                                        `/admin/users/customers/${item.id}/`,
                                    )
                                }
                                className="flex items-center gap-4 bg-white border border-gray-100 p-4 hover:border-primary/30 hover:shadow-md transition-all rounded-2xl group cursor-pointer active:scale-[0.98]"
                            >
                                <StockflowAvatar user={item} />

                                <div className="flex-1 min-w-0">
                                    <h6 className="font-bold text-gray-900 text-xs">
                                        {item.name}
                                    </h6>
                                    <p className="text-xs text-gray-400 truncate mt-1 leading-tight font-medium">
                                        {item.address || "No address provided"}
                                    </p>

                                    <div className="flex items-center gap-2 mt-2">
                                        <span className="text-[9px] bg-gray-50 text-gray-500 px-1.5 py-0.5 rounded-md uppercase font-bold tracking-tighter border border-gray-100">
                                            {item.agent_name}
                                        </span>
                                        <span className="text-[9px] text-gray-300 font-bold uppercase tracking-widest">
                                            Agent
                                        </span>
                                    </div>
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
            </>
        );
    }

    return (
        <>
            <div className="pt-2 flex justify-between items-center px-2 mb-4">
                <div className="flex flex-col">
                    <h2 className="text-xl font-extrabold items-center text-gray-900 leading-tight">
                        Customers
                    </h2>
                </div>

                <StockFlowButton
                    text="Add Customer"
                    variant="filled"
                    icon={<Plus className="size-4" />}
                    onClick={() => router.push("/admin/users/customers/new")}
                    className="shadow-lg shadow-primary/20 ring-1 ring-primary/10"
                />
            </div>

            {searchBar}

            {renderSection(
                businessCustomers,
                "Our customers",
                businessCustomers.length,
            )}
            {renderSection(otherCustomers, "Others", otherCustomers.length)}

            {businessCustomers.length === 0 && otherCustomers.length === 0}

            <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalCount={totalCount}
                pageSize={pageSize}
                onPageChange={handlePageChange}
                onPageSizeChange={handlePageSizeChange}
            />
        </>
    );
};

export default CustomerList;
