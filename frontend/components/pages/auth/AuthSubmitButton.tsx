import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface Props {
    loading: boolean;
    label: string;
    loadingLabel: string;
    icon: ReactNode;
    onClick: () => void;
}

export function AuthSubmitButton({
    loading,
    label,
    loadingLabel,
    icon,
    onClick,
}: Props) {
    return (
        <button
            type="button"
            disabled={loading}
            onClick={onClick}
            className={cn(
                "w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-base font-medium text-white transition-all",
                "bg-[var(--color-primary)] hover:opacity-90 active:scale-[0.98]",
                "disabled:opacity-60 disabled:cursor-not-allowed",
            )}
        >
            {loading ? (
                <>
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    {loadingLabel}
                </>
            ) : (
                <>
                    {icon}
                    {label}
                </>
            )}
        </button>
    );
}
