import { forwardRef, InputHTMLAttributes, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { cn } from "@/lib/utils";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  error?: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, Props>(
  ({ id, label, error, className, ...props }, ref) => {
    const [show, setShow] = useState(false);
    return (
      <Field>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <div className="relative flex items-center">
          <Input
            ref={ref}
            id={id}
            type={show ? "text" : "password"}
            aria-invalid={!!error}
            className={cn(
              "pr-10",
              error && "border-red-400 bg-red-50 focus:ring-red-200",
              className,
            )}
            {...props}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label={show ? "Hide password" : "Show password"}
            onClick={() => setShow((v) => !v)}
            className="absolute right-3 text-gray-400 hover:text-gray-600 transition-colors"
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      </Field>
    );
  },
);
PasswordInput.displayName = "PasswordInput";
