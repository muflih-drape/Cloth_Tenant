import React from "react";

interface StockFlowButtonProps {
  variant?: "filled" | "outline";
  text?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  fullWidth?: boolean;
}

const StockFlowButton: React.FC<StockFlowButtonProps> = ({
  variant = "filled",
  text = "",
  icon,
  onClick,
  className = "",
  disabled = false,
  fullWidth = false,
}) => {
  const baseStyles =
    "flex items-center justify-center gap-2 px-4 py-3 font-semibold text-sm rounded-[var(--radius)] transition-all";

  const variants = {
    filled: `
      ${baseStyles}
      bg-[var(--color-primary)] text-white
      hover:brightness-110
      disabled:opacity-50 disabled:cursor-not-allowed
    `,
    outline: `
      ${baseStyles}
      border border-[var(--color-primary)]
      text-[var(--color-primary)] bg-white
      hover:bg-[var(--color-primary)] hover:text-white
      disabled:opacity-50 disabled:cursor-not-allowed
    `,
  };

  return (
    <button
      className={`${variants[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon && <span className="flex items-center">{icon}</span>}
      {text && text}
    </button>
  );
};
export default StockFlowButton;
