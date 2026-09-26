"use client";

import { ReactNode } from "react";
import { Field, FieldLabel } from "@/components/ui/field";

interface FormFieldProps {
  label: string;
  error?: string;
  required?: boolean;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}

export default function FormField({
  label,
  error,
  required,
  hint,
  children,
  className = "",
}: FormFieldProps) {
  return (
    <Field className={className}>
      <div className="flex justify-between items-center mb-1.5">
        <FieldLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400">
          {label}
          {required && <span className="text-red-400 ml-0.5">*</span>}
        </FieldLabel>
      </div>
      {children}
      {error && (
        <p className="mt-1.5 text-[10px] font-bold text-red-500 flex items-center gap-1">
          <span className="inline-block w-1 h-1 rounded-full bg-red-400 flex-shrink-0" />
          {error}
        </p>
      )}
      {!error && hint && (
        <p className="mt-1.5 text-[11px] text-gray-400">{hint}</p>
      )}
    </Field>
  );
}
