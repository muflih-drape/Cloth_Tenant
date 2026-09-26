"use client";
import OrderItem from "@/components/pages/admin/order-item/OrderItem";
import { PageLoading } from "@/components/ui/Loading";
import { orderApi } from "@/lib/api/order";
import { OrderResponse } from "@/types/order";
import { ChevronLeft, Save } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function EditOrderPage() {
    const params = useParams();
    const id = params.id as string;
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<OrderResponse>();

    useEffect(() => {
        setLoading(true);

        const fetchData = async () => {
            try {
                const response = await orderApi.getOne(Number(id));
                setData(response);
            } catch (error) {
                console.error("Error fetching data:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [id]);

    if (loading) return <PageLoading />;
    return (
        <div className="min-h-screen min-w-full">
            <div className="w-full">
                <Link
                    className="flex text-(--color-primary) items-center"
                    href={`/admin/order/status/${id}`}
                >
                    <ChevronLeft size={18} />
                    <h5>Back</h5>
                </Link>
            </div>
            <div className="mt-3 flex justify-between">
                <div className="text-[20px]">Ordered Items</div>
                <button className="flex gap-1 text-white bg-(--color-primary) items-center rounded-md px-2 py-1">
                    <h5>Save</h5>
                    <Save />
                </button>
            </div>
            <OrderItem items={data?.items} />
        </div>
    );
}
