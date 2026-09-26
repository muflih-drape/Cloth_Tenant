import { Package } from "lucide-react";

export function AuthBranding() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="w-14 h-14 rounded-2xl bg-[var(--color-primary)] flex items-center justify-center shadow-lg">
        <Package size={28} className="text-white" />
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-bold text-[var(--color-heading)] mb-0">
          XL Apparals
        </h1>
        <p className="text-[11px] text-[var(--color-text)] uppercase tracking-widest font-medium">
          Order Management
        </p>
      </div>
    </div>
  );
}
