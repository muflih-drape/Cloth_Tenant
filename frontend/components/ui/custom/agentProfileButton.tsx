"use client";

import { useRouter } from "next/navigation";
import StockflowAvatar from "./stockflowAvatar";
import { useAuth } from "@/context/AuthContext";

const AgentProfileButton: React.FC = () => {
  const router = useRouter();
  const { user } = useAuth();

  return (
    <div
      className="flex relative w-full justify-end  pt-2 pr-2"
      title="View Profile"
    >
      <div
        className="cursor-pointer"
        onClick={() => router.push("/agent/profile")}
      >
        <StockflowAvatar user={user} />
      </div>
    </div>
  );
};

export default AgentProfileButton;
