"use client";

import { usePathname, useRouter } from "next/navigation";
import {
    Home,
    History,
    Package,
    Plus,
    Loader2,
    LucideIcon,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import { PageLoading } from "./Loading";

type NavItem = {
    label: string;
    path: string;
    icon: LucideIcon;
    match?: (pathname: string) => boolean;
    isHighlighted?: boolean;
};

const NavButton = ({
    item,
    pathname,
    loadingPath,
    onNavigate,
    isHighlighted = false,
}: {
    item: NavItem;
    pathname: string;
    loadingPath: string | null;
    onNavigate: (path: string) => void;
    isHighlighted?: boolean;
}) => {
    const isLoading = loadingPath === item.path;

    const isActive = item.match ? item.match(pathname) : pathname === item.path;

    const Icon = item.icon;

    return (
        <button
            onClick={() => onNavigate(item.path)}
            disabled={!!loadingPath}
            className={`
        flex flex-col items-center justify-center flex-1 h-14 relative
        transition-all duration-200
        active:scale-90
        disabled:cursor-not-allowed
        ${isLoading ? "opacity-70 scale-95" : ""}
        ${
            isHighlighted
                ? "bg-(--color-primary) text-white shadow-lg rounded-xl"
                : isActive || isLoading
                  ? "bg-primary text-white shadow-lg rounded-xl"
                  : "text-gray-400 hover:text-gray-600"
        }

      `}
        >
            <div className="p-2 rounded-xl transition-all duration-300">
                {isLoading ? (
                    <Loader2 className="animate-spin" size={18} />
                ) : (
                    <Icon
                        size={isActive ? 20 : 18}
                        strokeWidth={isActive ? 2.5 : 2}
                    />
                )}
            </div>

            <span
                className={`
          uppercase transition-all duration-300 mt-1
          ${isActive || isLoading || isHighlighted ? "opacity-100 font-bold text-[10px]" : "opacity-60 font-semibold text-[8px]"}
        `}
            >
                {item.label}
            </span>
        </button>
    );
};

const NavBar: React.FC = () => {
    const pathname = usePathname();
    const router = useRouter();

    const [isPending, startTransition] = React.useTransition();
    const [loadingPath, setLoadingPath] = useState<string | null>(null);

    let isHome = pathname === "/agent";

    const handleNavigation = (path: string) => {
        if (loadingPath || pathname === path) {
            isHome = pathname === "/agent";
            return;
        }

        setLoadingPath(path);

        startTransition(() => {
            router.push(path);
        });
    };

    useEffect(() => {
        if (!isPending) {
            // eslint-disable-next-line react-hooks/exhaustive-deps
            setLoadingPath(null);
        }
    }, [isPending]);

    const navItems: NavItem[] = [
        {
            label: "History",
            path: "/agent/history",
            icon: History,
        },

        isHome
            ? {
                  label: "New Order",
                  path: "/agent/order/new",
                  icon: Plus,
                  isHighlighted: true,
              }
            : {
                  label: "Orders",
                  path: "/agent",
                  icon: Home,
              },

        {
            label: "My Items",
            path: "/agent/items",
            icon: Package,
            match: (pathname) => pathname.startsWith("/agent/items"),
        },
    ];

    return (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none pb-[env(safe-area-inset-bottom,1.5rem)] mb-4">
            <div className="bg-white/70 backdrop-blur-2xl border border-white/40 w-[calc(100%-2rem)] max-w-md pointer-events-auto py-2.5 px-6 flex items-center justify-between shadow-[0_20px_50px_-12px_rgba(0,0,0,0.2)] rounded-xl mx-auto transition-all duration-500">
                {navItems.map((item) => (
                    <NavButton
                        key={item.path}
                        item={item}
                        pathname={pathname}
                        loadingPath={loadingPath}
                        onNavigate={handleNavigation}
                        isHighlighted={item.isHighlighted}
                    />
                ))}
            </div>
        </div>
    );
};

export default NavBar;
