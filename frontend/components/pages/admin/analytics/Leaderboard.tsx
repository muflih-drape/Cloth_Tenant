"use client";

import Link from "next/link";
import { useState } from "react";

interface LeaderboardItem {
  id: number;
  label: string;
  count: number;
}

interface LeaderboardProps {
  title: string;
  items: { id: number; name: string; count: number }[];
  linkBase?: string;
  showAllInitial?: number;
}

export default function Leaderboard({
  title,
  items,
  linkBase,
  showAllInitial = 5,
}: LeaderboardProps) {
  const [showAll, setShowAll] = useState(false);

  const displayItems: LeaderboardItem[] = items.map((item) => ({
    id: item.id,
    label: item.name,
    count: item.count,
  }));

  const visible = showAll
    ? displayItems
    : displayItems.slice(0, showAllInitial);

  return (
    <div className="bg-white rounded-xl border p-4 shadow-sm mb-4">
      <div className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-3">
        {title}
      </div>
      {displayItems.length === 0 ? (
        <div className="text-center text-gray-400 text-xs py-4">
          No data in range
        </div>
      ) : (
        <>
          {visible.map((item, idx) => {
            const content = (
              <div className="flex items-center py-2 border-b last:border-0">
                <span className="text-xs font-bold text-gray-400 w-5">
                  {idx + 1}
                </span>
                <span className="flex-1 text-sm font-medium text-gray-700">
                  {item.label}
                </span>
                <span className="text-sm font-bold text-gray-900">
                  {item.count}
                </span>
              </div>
            );

            if (linkBase) {
              return (
                <Link
                  key={item.id}
                  href={`${linkBase}?${title === "Top Customers" ? "customer" : "agent"}=${item.id}`}
                  className="block hover:bg-gray-50 -mx-4 px-4"
                >
                  {content}
                </Link>
              );
            }

            return <div key={item.id}>{content}</div>;
          })}
          {displayItems.length > showAllInitial && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="text-xs font-bold text-primary mt-2"
            >
              {showAll ? "Show less" : `Show all (${displayItems.length})`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
