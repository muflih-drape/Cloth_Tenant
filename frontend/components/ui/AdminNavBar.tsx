"use client";

import { usePathname, useRouter } from "next/navigation";
import { Truck, Users, Archive, BarChart3, Store, Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import React, { useEffect, useState } from "react";
import { PageLoading } from "./Loading";

const AdminNavBar: React.FC = () => {
    const pathname = usePathname();
    const router = useRouter();
    const { isSuperuser } = useAuth();

    const [mounted, setMounted] = useState(false);
    const [loadingPath, setLoadingPath] = useState<string | null>(null);

    useEffect(() => setMounted(true), []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/exhaustive-deps
        setLoadingPath(null);
    }, [pathname]);

    if (!mounted) return null;

    const navItems = [
        {
            label: "Users",
            icon: Users,
            path: "/admin/users",
        },
        {
            label: "Orders",
            icon: Truck,
            path: "/admin",
        },
        {
            label: "Settings",
            icon: Store,
            path: "/admin/settings",
            requiresSuperuser: true,
        },
        {
            label: "Stats",
            icon: BarChart3,
            path: "/admin/analytics",
        },
        {
            label: "Stock",
            icon: Archive,
            path: "/admin/items",
        },
    ];

    const handleNavigation = (path: string) => {
        if (loadingPath || pathname === path) return;

        setLoadingPath(path);
        router.push(path);
    };

    return (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none pb-[env(safe-area-inset-bottom,1.5rem)] mb-4">
            <div className="bg-white/70 backdrop-blur-2xl border border-white/40 w-[calc(100%-2rem)] max-w-md pointer-events-auto py-2.5 px-4 flex items-center justify-between shadow-[0_20px_50px_-12px_rgba(0,0,0,0.2)] rounded-xl mx-auto transition-all duration-500">
                {navItems.map((item) => {
                    if (item.requiresSuperuser && !isSuperuser) return null;

                    const isActive =
                        pathname === item.path ||
                        (item.path !== "/admin" &&
                            pathname.startsWith(item.path));

                    const isLoading = loadingPath === item.path;

                    return (
                        <button
                            key={item.path}
                            onClick={() => handleNavigation(item.path)}
                            className={`
                flex flex-col items-center justify-center flex-1 h-14 relative
                transition-all duration-200
                active:scale-90
                disabled:cursor-not-allowed
                ${isLoading ? "opacity-70 scale-95" : ""}
                ${
                    isActive || isLoading
                        ? "bg-primary text-white shadow-lg rounded-xl"
                        : "text-gray-400 hover:text-gray-600"
                }
              `}
                        >
                            <div className="p-2 rounded-xl transition-all duration-300">
                                {isLoading ? (
                                    <Loader2
                                        className="animate-spin"
                                        size={18}
                                    />
                                ) : (
                                    <item.icon
                                        size={isActive ? 20 : 18}
                                        strokeWidth={isActive ? 2.5 : 2}
                                    />
                                )}
                            </div>

                            <span
                                className={`
                  text-[8px] font-semibold uppercase transition-all duration-300 mt-1
                  ${isActive || isLoading ? "opacity-100" : "opacity-60"}
                `}
                            >
                                {item.label}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default AdminNavBar;
