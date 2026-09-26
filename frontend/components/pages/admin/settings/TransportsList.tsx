"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { transportApi } from "@/lib/api/transport";
import { TransportAllResponse } from "@/types/transport";
import { Plus, Truck, Pencil, Trash2 } from "lucide-react";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import { toastSuccess, toastError } from "@/lib/toast";
import { PageLoading } from "@/components/ui/Loading";

export default function TransportsList() {
    const [data, setData] = useState<TransportAllResponse>([]);
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    const fetchData = async () => {
        setLoading(true);
        try {
            const response = await transportApi.getAll();
            setData(response);
        } catch (error) {
            console.error("Error fetching transports:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleDelete = async (id: number, name: string) => {
        if (!confirm(`Delete transport "${name}"?`)) return;
        try {
            await transportApi.delete(id);
            toastSuccess("Transport deleted successfully");
            fetchData();
        } catch (error) {
            toastError("Failed to delete transport");
        }
    };

    if (loading) {
        return <PageLoading />;
    }

    return (
        <div>
            <div className="flex w-full justify-end px-4 mb-4">
                <StockFlowButton
                    text="Add Transport"
                    variant="filled"
                    icon={<Plus className="size-4" />}
                    onClick={() =>
                        router.push("/admin/settings/transports/new")
                    }
                    className="shadow-lg shadow-primary/20 ring-1 ring-primary/10"
                />
            </div>

            {data.length === 0 ? (
                <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 px-4">
                    <Truck size={48} className="text-gray-300" />
                    <h2 className="text-xl font-bold text-gray-400">
                        No Transports
                    </h2>
                </div>
            ) : (
                <div className="px-4 space-y-3 pb-20">
                    {data.map((transport) => (
                        <div
                            key={transport.id}
                            className="flex items-center gap-4 bg-white border border-gray-100 p-4 hover:border-primary/30 hover:shadow-md transition-all rounded-2xl group"
                        >
                            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                                <Truck size={20} className="text-primary" />
                            </div>

                            <div className="flex-1 min-w-0 px-2">
                                <h6 className="font-bold text-gray-900 text-base truncate leading-tight">
                                    {transport.name}
                                </h6>
                                <span
                                    className={`text-xs font-bold ${
                                        transport.is_active
                                            ? "text-green-600"
                                            : "text-gray-400"
                                    }`}
                                >
                                    {transport.is_active
                                        ? "Active"
                                        : "Inactive"}
                                </span>
                            </div>

                            <div className="flex gap-2">
                                <button
                                    onClick={() =>
                                        router.push(
                                            `/admin/settings/transports/${transport.id}/edit`,
                                        )
                                    }
                                    className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
                                >
                                    <Pencil
                                        size={16}
                                        className="text-gray-400"
                                    />
                                </button>
                                <button
                                    onClick={() =>
                                        handleDelete(
                                            transport.id,
                                            transport.name,
                                        )
                                    }
                                    className="p-2 hover:bg-red-50 rounded-xl transition-colors"
                                >
                                    <Trash2
                                        size={16}
                                        className="text-red-400"
                                    />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
