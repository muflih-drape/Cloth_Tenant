"use client";
import { useAuth } from "@/context/AuthContext";
import { agentApi } from "@/lib/api/agents";
import { AssignedItem } from "@/types/agent";
import { PageLoading } from "@/components/ui/Loading";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { ItemList } from "@/components/items";
import { ItemType, UIItem } from "@/types/item";
import { useBackButton } from "@/util/useBackButton";

function normalizeAgentItem(item: AssignedItem): UIItem {
    return {
        id: item.id,
        name: item.name,
        type: item.type as ItemType,
        price: item.price,
        variants: item.variants.map((v) => ({
            id: v.id,
            image: v.image,
            qr_code: v.qr_code,
            sizes: v.size_ranges.map((s) => ({
                size_range: s.size_range,
                stock: s.stock,
            })),
        })),
    };
}

export default function MyItemsPage() {
    const { user } = useAuth();
    const [items, setItems] = useState<UIItem[]>([]);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const [initialLoading, setInitialLoading] = useState(true);

    useBackButton({
        onBack: useCallback(() => {
            router.push("/agent/");
        }, [router]),
    });

    const fetchData = useCallback(async () => {
        if (!user?.id) return;

        try {
            const agent = await agentApi.getProfile(user.id);
            setItems((agent.assigned_items || []).map(normalizeAgentItem));
        } catch (error) {
            console.error("Error fetching items:", error);
        } finally {
            setInitialLoading(false);
        }
    }, [user?.id]);

    useEffect(() => {
        if (!user?.id) return;
        fetchData();
        const handleFocus = () => fetchData();
        window.addEventListener("focus", handleFocus);
        const interval = setInterval(fetchData, 30000);
        return () => {
            window.removeEventListener("focus", handleFocus);
            clearInterval(interval);
        };
    }, [user?.id, fetchData]);

    const handleOrder = useCallback(() => {
        router.push("/agent/order/new");
    }, [router]);

    const handlePriceCheck = useCallback(() => {
        router.push("/agent/items/scanner");
    }, [router]);

    if (initialLoading) return <PageLoading />;

    return (
        <ItemList
            items={items}
            loading={false}
            context="agent"
            onOrder={handleOrder}
            onPriceCheck={handlePriceCheck}
        />
    );
}
