"use client";
import { PageLoading } from "@/components/ui/Loading";
import { useAuth } from "@/context/AuthContext";
import { agentApi } from "@/lib/api/agents";
import { authApi } from "@/lib/api/auth";
import { itemApi } from "@/lib/api/item";
import { orderApi } from "@/lib/api/order";
import { toastSuccess } from "@/lib/toast";
import { AgentResponse } from "@/types/agent";
import { UserProfile } from "@/types/auth";
import { UIItem } from "@/types/item";
import { Order } from "@/types/order";
import {
  ChevronRight,
  LogOut,
  User,
  Mail,
  ShieldCheck,
  Phone,
  Upload,
  Archive,
  ShoppingBag,
  Users,
  ScrollText,
} from "lucide-react";
import ItemCard from "@/components/items/ItemCard";
import OrderCard from "@/components/order/OrderCard";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Tab = "profile" | "archives";

export default function ProfilePage() {
  const { user, logout, isSuperuser } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("profile");
  const [agentData, setAgentData] = useState<AgentResponse>();
  const [profile, setProfile] = useState<UserProfile>();
  const [archivedItems, setArchivedItems] = useState<UIItem[]>([]);
  const [archivedOrders, setArchivedOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [archivesLoading, setArchivesLoading] = useState(false);

  const [expandedItem, setExpandedItem] = useState<number | null>(null);

  const isAdmin = profile?.role === "ADMIN" || isSuperuser;

  useEffect(() => {
    const fetchData = async () => {
      try {
        const profileData = await authApi.getProfile();
        setProfile(profileData);

        if (user?.id && !isAdmin) {
          const agent = await agentApi.getProfile(user.id);
          setAgentData(agent);
        }
      } catch (e) {
        console.error("Error fetching profile:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user]);

  useEffect(() => {
    if (tab !== "archives") return;
    const fetchArchives = async () => {
      setArchivesLoading(true);
      try {
        const [items, orders] = await Promise.all([
          itemApi.getArchived(),
          orderApi.getArchived(),
        ]);
        setArchivedItems(items as UIItem[]);
        setArchivedOrders(orders.results);
      } catch (e) {
        console.error("Error fetching archives:", e);
      } finally {
        setArchivesLoading(false);
      }
    };
    fetchArchives();
  }, [tab]);

  const handleLogout = () => {
    logout();
    toastSuccess("Successfully logged out");
    router.push("/");
  };

  if (loading) return <PageLoading />;

  const displayName = profile?.display_name || profile?.username || "User";

  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 pt-2 pb-4">
        <div className="max-w-lg mx-auto">
          <div className="flex w-full justify-between items-center gap-2 min-w-0 py-4">
            <h1 className="text-xl font-black text-gray-900 truncate">
              {displayName}
            </h1>
            <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-primary bg-primary/8 px-2 py-0.5 rounded-full shrink-0">
              <ShieldCheck size={10} />
              {profile?.role || "User"}
            </span>
          </div>

          {/* Tab Bar */}
          <div className="flex gap-1 bg-gray-100 p-1.5 rounded-md border border-gray-200">
            {(["profile", "archives"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 text-xs font-black rounded-md capitalize transition-all ${
                  tab === t
                    ? "bg-black text-white shadow-sm"
                    : "text-gray-400 hover:text-gray-600"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4">
        {/* ── Profile Tab ── */}
        {tab === "profile" && (
          <div className="space-y-3">
            {/* Info Cards */}
            <div className="rounded-3xl border border-gray-100 shadow-sm divide-y divide-gray-50">
              <InfoRow
                icon={<User size={16} />}
                iconBg="bg-blue-50 text-blue-500"
                label="Username"
                value={displayName}
              />
              <InfoRow
                icon={<Mail size={16} />}
                iconBg="bg-purple-50 text-purple-500"
                label="Email"
                value={profile?.email || "N/A"}
              />
              {agentData?.contact && (
                <InfoRow
                  icon={<Phone size={16} />}
                  iconBg="bg-amber-50 text-amber-500"
                  label="Contact"
                  value={`+91 ${agentData.contact}`}
                />
              )}
              {profile?.business && (
                <InfoRow
                  icon={<ShieldCheck size={16} />}
                  iconBg="bg-green-50 text-green-500"
                  label="Business"
                  value={profile.business}
                />
              )}
            </div>

            {/* Actions */}
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm divide-y divide-gray-50">
              {isAdmin ? (
                <ActionRow
                  icon={<Upload size={16} />}
                  iconBg="bg-indigo-50 text-indigo-500"
                  label="Bulk Import"
                  onClick={() => router.push("/admin/bulk-import")}
                />
              ) : (
                <ActionRow
                  icon={<Users size={16} />}
                  iconBg="bg-teal-50 text-teal-500"
                  label="My Customers"
                  badge={Number(agentData?.total_customers) || 0}
                  onClick={() =>
                    router.push(
                      isAdmin ? "/admin/customers" : "/agent/customers",
                    )
                  }
                />
              )}
            </div>

            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm divide-y divide-gray-50">
              {isAdmin && (
                <ActionRow
                  icon={<ScrollText size={16} />}
                  iconBg="bg-indigo-50 text-indigo-500"
                  label="Summary"
                  onClick={() => router.push("/admin/summary")}
                />
              )}
            </div>

            {/* Sign Out */}
            <button
              onClick={handleLogout}
              className="flex items-center justify-center gap-2 w-full text-rose-500 font-black py-3.5 rounded-3xl border border-rose-100 bg-white shadow-sm hover:bg-rose-50 transition-all active:scale-95 text-sm"
            >
              <LogOut size={16} />
              Sign Out
            </button>
          </div>
        )}

        {/* ── Archives Tab ── */}
        {tab === "archives" && (
          <div className="space-y-4">
            {archivesLoading ? (
              <div className="flex justify-center py-10">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
              </div>
            ) : (
              <>
                {/* Archived Items */}
                <section>
                  <p className="text-[11px] text-gray-400 px-1 mb-2 leading-relaxed">
                    Archived items are permanently deleted 30 days after being
                    archived. Existing orders keep their item details.
                  </p>
                  <SectionHeader
                    icon={<Archive size={14} />}
                    label="Archived Items"
                  />
                  {archivedItems.length === 0 ? (
                    <EmptyState label="No archived items" />
                  ) : (
                    <div className="space-y-2">
                      {archivedItems.map((item) => (
                        <ItemCard
                          key={item.id}
                          item={item}
                          isExpanded={expandedItem == item.id}
                          onToggle={() => setExpandedItem(item.id)}
                          context={isAdmin ? "admin" : "agent"}
                          isReadonly={true}
                          countdownDays={item.days_until_purge}
                        />
                      ))}
                    </div>
                  )}
                </section>

                {/* Archived Orders */}
                <section>
                  <SectionHeader
                    icon={<ShoppingBag size={14} />}
                    label="Archived Orders"
                  />
                  {archivedOrders.length === 0 ? (
                    <EmptyState label="No archived orders" />
                  ) : (
                    <div className="space-y-2">
                      {archivedOrders.map((order) => (
                        <OrderCard key={order.id} order={order} viewed={true} />
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────

function InfoRow({
  icon,
  iconBg,
  label,
  value,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div
        className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-gray-400 uppercase font-black tracking-wider leading-none mb-0.5">
          {label}
        </p>
        <p className="text-sm font-bold text-gray-800 truncate">{value}</p>
      </div>
    </div>
  );
}

function ActionRow({
  icon,
  iconBg,
  label,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full px-4 py-3 group hover:bg-gray-50/60 transition-colors"
    >
      <div
        className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}
      >
        {icon}
      </div>
      <span className="text-sm font-bold text-gray-700 flex-1 text-left">
        {label}
      </span>
      <div className="flex items-center gap-1">
        {badge !== undefined && (
          <span className="text-xs font-black text-primary bg-primary/8 px-2 py-0.5 rounded-lg">
            {badge}
          </span>
        )}
        <ChevronRight
          size={16}
          className="text-gray-300 group-hover:text-primary transition-colors"
        />
      </div>
    </button>
  );
}

function SectionHeader({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5 mb-2 px-1">
      <div className="flex items-center text-gray-400">{icon}</div>
      <h2 className="text-xs font-black text-gray-400 uppercase ">{label}</h2>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-8 text-center">
      <Archive size={22} className="text-gray-200" />
      <p className="text-xs font-bold text-gray-300">{label}</p>
    </div>
  );
}
