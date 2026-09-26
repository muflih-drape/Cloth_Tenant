"use client";
import { Info } from "lucide-react";

interface EmptyStateProps {
  title: string;
}

export default function EmptyState({ title }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-gray-300">
      <Info size={40} className="mb-4 opacity-20" />
      <h2 className="text-xl font-bold">{title}</h2>
    </div>
  );
}
