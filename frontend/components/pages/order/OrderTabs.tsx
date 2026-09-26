"use client";
import { Package, Truck } from "lucide-react";

type Tab = "Packing" | "Dispatching";

interface OrderTabsProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

export default function OrderTabs({ activeTab, onTabChange }: OrderTabsProps) {
  return (
    <div className="bg-gray-100/50 p-1.5 flex items-center justify-center space-x-1 border border-gray-200 rounded-full mb-6">
      <button
        onClick={() => onTabChange("Packing")}
        className={`flex-1 flex items-center justify-center gap-2 rounded-full py-2 font-bold text-xs transition-all ${
          activeTab === "Packing" ? "bg-primary text-white shadow-sm" : "text-gray-500 hover:text-gray-700"
        }`}
      >
        <Package size={14} />
        Packing
      </button>
      <button
        onClick={() => onTabChange("Dispatching")}
        className={`flex-1 flex items-center justify-center gap-2 rounded-full py-2 font-bold text-xs transition-all ${
          activeTab === "Dispatching" ? "bg-primary text-white shadow-sm" : "text-gray-500 hover:text-gray-700"
        }`}
      >
        <Truck size={14} />
        Dispatching
      </button>
    </div>
  );
}

export type { Tab };
