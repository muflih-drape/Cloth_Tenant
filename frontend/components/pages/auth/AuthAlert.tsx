import { AlertCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface Props {
  message?: string;
  sub?: string;
  warn?: boolean;
  suffix?: ReactNode;
}

export function AuthAlert({ message, sub, warn, suffix }: Props) {
  if (!message) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        "flex items-center gap-3 rounded-xl px-4 py-3 text-sm border",
        warn
          ? "bg-amber-50 border-amber-200 text-amber-800"
          : "bg-red-50 border-red-200 text-red-700",
      )}
    >
      {warn ? (
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
      ) : (
        <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-400" />
      )}
      <div>
        <p className="font-medium text-sm leading-snug">{message}</p>
        {sub && <p className="text-xs mt-0.5 opacity-80">{sub}</p>}
        {suffix}
      </div>
    </div>
  );
}
