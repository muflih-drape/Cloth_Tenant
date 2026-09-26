"use client";

import { Filter } from "lucide-react";

interface FilterToggleProps {
  isOpen: boolean;
  onToggle: () => void;
}

export default function FilterToggle({ isOpen, onToggle }: FilterToggleProps) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-2 p-2.5 sm:p-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm transition-colors"
    >
      <span className="text-xs font-medium text-gray-500">
        {isOpen ? "Hide filters" : "Show filters"}
      </span>
      <Filter className="text-gray-400 size-4" />
    </button>
  );
}
