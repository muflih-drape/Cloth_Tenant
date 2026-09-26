"use client";
import StockflowAvatar from "@/components/ui/custom/stockflowAvatar";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import { PageLoading } from "@/components/ui/Loading";
import { useAuth } from "@/context/AuthContext";
import { adminApi } from "@/lib/api/admin";
import { AdminAllResponse } from "@/types/admin";
import { Info, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const AdminsList: React.FC = () => {
    const { isAuthenticated } = useAuth();

    const [data, setData] = useState<AdminAllResponse>([]);
    const [loading, setLoading] = useState(true);

    const router = useRouter();

    useEffect(() => {
        setLoading(true);

        const fetchData = async () => {
            try {
                const response = await adminApi.getAll();
                setData(response);
            } catch (error) {
                console.error("Error fetching data:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [isAuthenticated, router]);

    if (loading) {
        return <PageLoading />;
    }
    if (data.length == 0)
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
                <h2 className="text-xl font-bold text-gray-400">No Admins</h2>
                <StockFlowButton
                    text="Add Admin"
                    variant="filled"
                    icon={<Plus className="size-4" />}
                    onClick={() => router.push("/admin/users/admins/new")}
                    className="shadow-lg shadow-primary/20 ring-1 ring-primary/10"
                />
            </div>
        );

    return (
        <>
            <div className="pt-2 flex justify-between items-center px-4 mb-6">
                <div className="flex flex-col">
                    <h2 className="text-xl font-extrabold text-gray-900 leading-tight">
                        Admins
                    </h2>
                    <div className="flex gap-2 items-center mt-1">
                        <span className="text-gray-400 text-[10px] font-bold uppercase tracking-wider">
                            Total Admins
                        </span>
                        <div className="bg-primary/10 text-primary rounded-full py-0.5 px-3 border border-primary/20">
                            <span className="font-bold text-xs">
                                {data.length}
                            </span>
                        </div>
                    </div>
                </div>
                <StockFlowButton
                    text="Add Admin"
                    variant="filled"
                    icon={<Plus className="size-4" />}
                    onClick={() => router.push("/admin/users/admins/new")}
                    className="shadow-lg shadow-primary/20 ring-1 ring-primary/10"
                />
            </div>
            <div className="px-4 space-y-3 pb-20">
                {data?.map((item) => (
                    <div
                        key={item.id}
                        onClick={() =>
                            router.push(`/admin/users/admins/${item.id}/`)
                        }
                        className="flex items-center gap-4 bg-white border border-gray-100 p-4 hover:border-primary/30 hover:shadow-md transition-all rounded-2xl group cursor-pointer active:scale-[0.98]"
                    >
                        <StockflowAvatar user={item} />

                        <div className="flex-1 min-w-0 px-2">
                            <h6 className="font-bold text-gray-900 text-base truncate leading-tight">
                                {item.display_name || item.username}
                            </h6>
                            <p className="text-xs text-gray-400 truncate mt-1 leading-tight font-medium">
                                {item.email}
                            </p>
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

export default AdminsList;
