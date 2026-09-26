"use client";

import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import StockflowAvatar from "./stockflowAvatar";
import { useEffect, useState } from "react";

const AdminProfileButton: React.FC = () => {
  const router = useRouter();
  const { business, isSuperuser, user } = useAuth();

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex w-full justify-between px-2 py-1">
        <div className="text-primary text-md font-black tracking-wider">—</div>
      </div>
    );
  }

  const businessLabel = business
    ? business.charAt(0).toUpperCase() + business.slice(1)
    : "";

  return (
    <div className="flex relative w-full justify-between">
      <div className="flex items-center px-2 py-1 text-primary text-md font-black tracking-wider">
        {businessLabel || (isSuperuser ? "Superuser" : "")}
      </div>
      <div
        className="flex  cursor-pointer"
        onClick={() => router.push("/admin/profile")}
      >
        <StockflowAvatar user={user} />
      </div>
    </div>
  );
};

export default AdminProfileButton;
