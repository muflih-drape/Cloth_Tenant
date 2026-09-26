"use client";

import AdminNavBar from "@/components/ui/AdminNavBar";
import AdminProfileButton from "@/components/ui/custom/adminProfileButton";
import PushNotificationInit from "@/lib/pushInit";
import { usePathname } from "next/navigation";

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const isStatusPage = pathname.includes("/admin/order/status/");
    const isNewOrderPage = pathname.includes("/admin/order/new");
    // The packing board is a focused, full-height workflow: it has its own
    // header and a sticky action bar, so it takes the screen on its own.
    const isPackingBoard = pathname.includes("/admin/packing/");
    const isFullscreenPage =
        pathname.includes("/admin/items/new") ||
        pathname.includes("/admin/items/edit") ||
        pathname.includes("/admin/settings/brands") ||
        isStatusPage ||
        isNewOrderPage ||
        isPackingBoard;

    return (
        <div
            className={`admin-order-layout ${isFullscreenPage ? "" : "pb-32"}`}
        >
            <PushNotificationInit />
            <AdminProfileButton />
            {children}
            {!isFullscreenPage && <AdminNavBar />}
        </div>
    );
}
