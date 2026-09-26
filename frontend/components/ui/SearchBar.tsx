"use client";

import { Search, X } from "lucide-react";
import { Spinner } from "./spinner";
import { PageLoading } from "./Loading";

interface SearchBarProps {
    value: string;
    onChange: (value: string) => void;
    isLoading?: boolean;
    placeholder?: string;
}

export default function SearchBar({
    value,
    onChange,
    isLoading = false,
    placeholder = "Search...",
}: SearchBarProps) {
    return (
        <div className="relative flex-1">
            {isLoading ? (
                <Spinner className="absolute left-3 top-1/2 -translate-y-1/2" />
            ) : (
                <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                    size={16}
                />
            )}
            <input
                type="text"
                placeholder={placeholder}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full pl-9 pr-8 py-2.5 sm:py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm"
            />
            {value && (
                <button
                    onClick={() => onChange("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
                >
                    <X size={14} />
                </button>
            )}
        </div>
    );
}
