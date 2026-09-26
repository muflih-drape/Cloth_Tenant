"use client";

import React from "react";
import { OrderStatus } from "@/types/order";

interface StatusBadgeProps {
  status: OrderStatus | string | undefined;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const getStatusStyles = (status: string | undefined) => {
    if (!status) return "bg-gray-50 text-gray-400 border-gray-200";
    switch (status.toUpperCase()) {
      case "PENDING":
        return "bg-amber-50 text-amber-600 border-amber-200";
      case "PACKED":
        return "bg-orange-50 text-orange-600 border-orange-200";
      case "DISPATCHED":
        return "bg-green-50 text-green-700 border-green-200";
      default:
        return "bg-gray-50 text-gray-600 border-gray-200";
    }
  };

  return (
    <div
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${getStatusStyles(
        status
      )}`}
    >
      {status}
    </div>
  );
};

export default StatusBadge;
