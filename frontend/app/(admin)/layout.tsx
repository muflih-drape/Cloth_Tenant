"use client";

import AdminNavBar from "@/components/ui/AdminNavBar";
import AdminProfileButton from "@/components/ui/custom/adminProfileButton";
import PushNotificationInit from "@/lib/pushInit";
import { usePathname } from "next/navigation";
import { SizeRangeProvider } from "@/context/SizeRangeContext";

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const isStatusPage = pathname.includes("/admin/order/status/");
    const isNewOrderPage = pathname.includes("/admin/order/new");
    const isFullscreenPage =
        pathname.includes("/admin/items/new") ||
        pathname.includes("/admin/items/edit") ||
        pathname.includes("/admin/settings/brands") ||
        isStatusPage ||
        isNewOrderPage;

    return (
        <div
            className={`admin-order-layout ${isFullscreenPage ? "" : "pb-32"}`}
        >
            <SizeRangeProvider>
                <PushNotificationInit />
                <AdminProfileButton />
                {children}
                {!isFullscreenPage && <AdminNavBar />}
            </SizeRangeProvider>
        </div>
    );
}
