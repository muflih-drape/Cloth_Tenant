"use client";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";

interface OrderDetailHeaderProps {
  orderId: string;
  backHref: string;
}

export default function OrderDetailHeader({ orderId, backHref }: OrderDetailHeaderProps) {
  return (
    <div className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-gray-100 px-4 py-3 flex items-center justify-between">
      <Link
        className="flex items-center text-primary font-medium hover:opacity-70 transition-opacity"
        href={backHref}
      >
        <ChevronLeft size={20} className="mr-1" />
        <span>Back</span>
      </Link>
      <div className="text-sm font-bold text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
        Order #{orderId}
      </div>
    </div>
  );
}
