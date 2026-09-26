"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { brandApi } from "@/lib/api/brand";
import { BrandAllResponse } from "@/types/brand";
import { Plus, Store, Info } from "lucide-react";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import { PageLoading } from "@/components/ui/Loading";

export default function BrandsList() {
    const [data, setData] = useState<BrandAllResponse>([]);
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    useEffect(() => {
        const fetchData = async () => {
            try {
                const response = await brandApi.getAll();
                setData(response);
            } catch (error) {
                console.error("Error fetching brands:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    if (loading) {
        return <PageLoading />;
    }

    if (data.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 px-4">
                <Store size={48} className="text-gray-300" />
                <h2 className="text-xl font-bold text-gray-400">No Brands</h2>
                <StockFlowButton
                    text="Add Brand"
                    variant="filled"
                    icon={<Plus className="size-4" />}
                    onClick={() => router.push("/admin/settings/brands/new")}
                    className="shadow-lg shadow-primary/20 ring-1 ring-primary/10"
                />
            </div>
        );
    }

    return (
        <div className="px-4 space-y-3 pb-20">
            <div className="flex w-full justify-end px-4 mb-4">
                <StockFlowButton
                    text="Add Brand"
                    variant="filled"
                    icon={<Plus className="size-4" />}
                    onClick={() => router.push("/admin/settings/brands/new")}
                    className="shadow-lg shadow-primary/20 ring-1 ring-primary/10"
                />
            </div>

            {data.map((brand) => (
                <div
                    key={brand.id}
                    onClick={() =>
                        router.push(`/admin/settings/brands/${brand.id}`)
                    }
                    className="flex items-center gap-4 bg-white border border-gray-100 p-4 hover:border-primary/30 hover:shadow-md transition-all rounded-2xl group cursor-pointer active:scale-[0.98]"
                >
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 overflow-hidden">
                        {brand.logo_url ? (
                            <img
                                src={brand.logo_url}
                                alt={brand.name}
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <Store size={20} className="text-primary" />
                        )}
                    </div>

                    <div className="flex-1 min-w-0 px-2">
                        <h6 className="font-bold text-gray-900 text-base truncate leading-tight">
                            {brand.name}
                        </h6>
                        <p className="text-xs text-gray-400 truncate mt-1 leading-tight font-medium">
                            {brand.email}
                        </p>
                    </div>

                    <div className="text-gray-200 group-hover:text-primary/30 transition-colors pl-2">
                        <Info size={18} />
                    </div>
                </div>
            ))}
        </div>
    );
}
