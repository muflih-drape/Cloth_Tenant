import { Search } from "lucide-react";
import { Input } from "../input";

const AdminInputBar: React.FC = () => {
  return (
    <div className="relative">
      <div className="text-muted-foreground pointer-events-none absolute inset-y-0 left-0 flex items-center justify-center pl-3 peer-disabled:opacity-50">
        <Search className="size-4" />
      </div>
      <Input
        type="text"
        placeholder="search orders.."
        className="peer pl-9 py-6"
      />
    </div>
  );
};

export default AdminInputBar;
