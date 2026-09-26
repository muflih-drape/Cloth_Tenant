"use client";

import StockflowAvatar from "@/components/ui/custom/stockflowAvatar";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import { PageLoading } from "@/components/ui/Loading";
import { useAuth } from "@/context/AuthContext";
import { agentApi } from "@/lib/api/agents";
import { AgentAllResponse } from "@/types/agent";
import { Info, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const AgentsList: React.FC = () => {
    const { isAuthenticated } = useAuth();

    const [data, setData] = useState<AgentAllResponse>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");

    const router = useRouter();

    useEffect(() => {
        setLoading(true);

        const fetchData = async () => {
            try {
                const response = await agentApi.getAll();
                setData(response);
            } catch (error) {
                console.error("Error fetching data:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [isAuthenticated]);

    const filteredData = data.filter((item) =>
        (item.user.display_name || item.user.username)
            .toLowerCase()
            .includes(search.toLowerCase()),
    );

    if (loading) {
        return <PageLoading />;
    }

    if (data.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
                <h2 className="text-xl font-bold text-gray-400">No Agents</h2>
                <StockFlowButton
                    text="Add Agent"
                    variant="filled"
                    icon={<Plus className="size-4" />}
                    onClick={() => router.push("/admin/users/agents/new")}
                    className="shadow-lg shadow-primary/20 ring-1 ring-primary/10"
                />
            </div>
        );
    }

    return (
        <>
            <div className="pt-2 flex justify-between items-center mb-4">
                <div className="flex flex-col">
                    <h2 className="text-xl font-extrabold text-gray-900 leading-tight">
                        Agents
                    </h2>
                    <div className="flex gap-2 items-center mt-1">
                        <span className="text-gray-400 text-[10px] font-bold uppercase tracking-wider">
                            Total Agents
                        </span>
                        <div className="bg-primary/10 text-primary rounded-full py-0.5 px-3 border border-primary/20">
                            <span className="font-bold text-xs">
                                {data.length}
                            </span>
                        </div>
                    </div>
                </div>

                <StockFlowButton
                    text="Add Agent"
                    variant="filled"
                    icon={<Plus className="size-4" />}
                    onClick={() => router.push("/admin/users/agents/new")}
                    className="shadow-lg shadow-primary/20 ring-1 ring-primary/10"
                />
            </div>

            <div className="mb-4">
                <input
                    type="text"
                    placeholder="Search agents..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm"
                />
            </div>

            {filteredData.length === 0 ? (
                <div className="flex justify-center mt-10">
                    <h2 className="text-gray-400 font-semibold">
                        No matching agents
                    </h2>
                </div>
            ) : (
                <div className="space-y-3 pb-20">
                    {filteredData.map((item) => (
                        <div
                            key={item.id}
                            onClick={() =>
                                router.push(`/admin/users/agents/${item.id}/`)
                            }
                            className="flex items-center gap-4 bg-white border border-gray-100 p-4 hover:border-primary/30 hover:shadow-md transition-all rounded-2xl group cursor-pointer active:scale-[0.98]"
                        >
                            <StockflowAvatar user={item.user} />

                            <div className="flex-1 min-w-0 px-0">
                                <h6 className="font-bold text-gray-900 text-base truncate leading-tight">
                                    {item.user.display_name ||
                                        item.user.username}
                                </h6>
                                <p className="text-xs text-gray-400 truncate mt-1 leading-tight font-medium">
                                    {item.user.email}
                                </p>

                                <div className="flex items-center gap-1 mt-2 text-primary font-bold text-[10px]">
                                    <span className="px-1.5 py-0.5 rounded bg-primary/5 border border-primary/10 tracking-widest">
                                        +91 {item.contact}
                                    </span>
                                </div>
                            </div>

                            <div className="flex flex-col items-end justify-center px-1 border-l border-gray-50">
                                <span className="text-[10px] text-gray-300 font-bold uppercase tracking-widest mb-1">
                                    Clients
                                </span>
                                <span className="text-lg font-black leading-none text-gray-900">
                                    {item.total_customers}
                                </span>
                            </div>

                            <div className="text-gray-200 group-hover:text-primary/30 transition-colors pl-2">
                                <Info size={18} />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </>
    );
};

export default AgentsList;
