"use client";
import BrandsList from "@/components/pages/admin/settings/BrandsList";
import TransportsList from "@/components/pages/admin/settings/TransportsList";
import { useAuth } from "@/context/AuthContext";
import { useState } from "react";
import { Store, Truck } from "lucide-react";

type Tab = "Brands" | "Transports";

export default function SettingsPage() {
  const { isSuperuser } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (typeof window !== "undefined") {
      return (
        (sessionStorage.getItem("adminSettingsActiveTab") as Tab) || "Brands"
      );
    }
    return "Brands";
  });

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    sessionStorage.setItem("adminSettingsActiveTab", tab);
  };

  if (!isSuperuser) return null;

  const settingsTabs: Tab[] = ["Brands", "Transports"];

  const renderContent = () => {
    if (activeTab === "Brands") return <BrandsList />;
    if (activeTab === "Transports") return <TransportsList />;
  };

  return (
    <div className="min-h-screen min-w-full px-0">
      <div className="pt-2 flex justify-between items-center px-4 mb-6">
        <div className="flex flex-col">
          <h2 className="text-xl font-extrabold text-gray-900 leading-tight">
            {activeTab}
          </h2>
          <div className="flex gap-2 items-center mt-1">
            <span className="text-gray-400 text-[10px] font-bold uppercase tracking-wider">
              Manage {activeTab}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-gray-100/50 p-1.5 mt-2 mx-4 flex items-center justify-between space-x-1 border border-gray-200 rounded-full mb-6">
        {settingsTabs.map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab)}
            className={`flex-1 rounded-full py-2 font-bold text-xs transition-all duration-300 flex items-center justify-center gap-1.5 ${
              activeTab === tab
                ? "bg-primary text-white shadow-lg shadow-primary/20 ring-1 ring-primary/10"
                : "text-gray-400 hover:text-gray-600 hover:bg-gray-100/80"
            }`}
          >
            {tab === "Brands" ? (
              <Store size={14} />
            ) : (
              <Truck size={14} />
            )}
            {tab}
          </button>
        ))}
      </div>

      <div className="pb-10">{renderContent()}</div>
    </div>
  );
}
