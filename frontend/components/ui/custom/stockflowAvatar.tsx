import { Admin } from "@/types/admin";
import { AgentUser } from "@/types/agent";
import { AuthUser } from "@/types/auth";
import { SimpleAgent, SimpleCustomer } from "@/types/order";
import { getColorFromId } from "@/util/getColorFromId";
import { User } from "lucide-react";
import { useSyncExternalStore } from "react";

interface stockflowAvatarProps {
  user?: AuthUser | SimpleAgent | SimpleCustomer | AgentUser | Admin | null;
}

function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
const StockflowAvatar: React.FC<stockflowAvatarProps> = ({ user }) => {
  const isClient = useIsClient();

  if (!user || !isClient)
    return (
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-yellow-400 border border-gray-100 shadow-sm">
        <User size={18} color="white" />
      </div>
    );

  const username =
    (user && "display_name" in user && user.display_name) ||
    (user && "username" in user && user.username) ||
    (user && "name" in user && user.name) ||
    "";

  const userId = user.id || 0;

  const safeUsername = username?.trim() || "";

  return (
    <div
      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border border-gray-100 shadow-sm"
      style={{
        backgroundColor: getColorFromId(userId),
      }}
    >
      {safeUsername.trim().length > 0 ? (
        <span className="text-white font-bold">
          {safeUsername[0].toUpperCase()}
        </span>
      ) : (
        <User size={18} color="white" />
      )}
    </div>
  );
};

export default StockflowAvatar;
