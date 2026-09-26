import { cn } from "@/lib/utils";
import { HTMLAttributes } from "react";

interface Props extends HTMLAttributes<HTMLDivElement> {
  shake?: boolean;
  onShakeEnd?: () => void;
}

export function AuthCard({
  shake,
  onShakeEnd,
  children,
  className,
  ...props
}: Props) {
  return (
    <div
      className={cn(
        "w-full max-w-sm bg-white shadow-xl rounded-3xl px-8 py-10 flex flex-col gap-8",
        shake && "animate-shake",
        className,
      )}
      onAnimationEnd={onShakeEnd}
      {...props}
    >
      {children}
    </div>
  );
}
