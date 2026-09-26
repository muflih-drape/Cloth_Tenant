"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface StockFlowSelectProps {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  className?: string;
}

export default function StockFlowSelect({
  value,
  placeholder,
  onChange,
  options,
  className,
}: StockFlowSelectProps) {
  return (
    <Select
      value={options.find((op) => op.value == value)?.label}
      onValueChange={onChange}
    >
      <SelectTrigger className={`w-full ${className}`}>
        <SelectValue placeholder={placeholder || "Select"} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
