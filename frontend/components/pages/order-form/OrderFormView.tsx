import { RefObject } from "react";
import { InvoiceResponse } from "@/types/order";

interface OrderFormProps extends InvoiceResponse {
    invoiceRef?: RefObject<HTMLDivElement | null>;
}

const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "numeric",
        year: "numeric",
    });

const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
    });

export default function OrderForm({
    id,
    customer,
    agent,
    brand,
    created_at,
    items,
    total_price,
    gst_rate = 0,
    invoiceRef,
    status,
}: OrderFormProps) {
    const gstAmount = total_price * (gst_rate / 100);
    const totalWithGst = total_price + gstAmount;
    const totalPieces = items.reduce(
        (sum, item) => sum + item.quantity * (item.piece_count || 1),
        0,
    );

    return (
        <div ref={invoiceRef} className="bg-white w-full">
            {/* ── Brand Header ── */}
            <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 rounded overflow-hidden flex items-center justify-center bg-gray-100">
                    {brand?.logo_url ? (
                        <img
                            src={brand.logo_url}
                            alt="Brand Logo"
                            className="w-12 h-12 object-cover rounded"
                        />
                    ) : (
                        <span className="text-[#0f1f3d] text-lg font-bold">
                            {(brand?.name ?? items[0]?.item_type ?? "BR")
                                .slice(0, 2)
                                .toUpperCase()}
                        </span>
                    )}
                </div>
                <div className="text-right">
                    <p className="text-[#0f1f3d] font-bold text-base">
                        {brand?.name ?? items[0]?.item_type}
                    </p>
                    {brand?.address_line1 && (
                        <p className="text-xs text-gray-600">
                            {brand.address_line1}
                        </p>
                    )}
                    {brand?.address_line2 && (
                        <p className="text-xs text-gray-600">
                            {brand.address_line2}
                        </p>
                    )}
                    {brand?.phone && (
                        <p className="text-xs text-gray-600">{brand.phone}</p>
                    )}
                    {brand?.email && (
                        <p className="text-xs text-gray-600">{brand.email}</p>
                    )}
                    {brand?.gst && (
                        <p className="text-xs text-gray-600">
                            GST : {brand.gst}
                        </p>
                    )}
                </div>
            </div>

            <div className="border-b-2 border-[#0f1f3d] mb-4" />

            {/* ── ORDER FORM Title ── */}
            <div className="flex justify-between items-start mb-4">
                <p className="text-[#0f1f3d] text-xl font-bold tracking-wider">
                    ORDER FORM
                </p>
                <div className="text-right text-xs text-gray-700">
                    <p>
                        Order Form{" "}
                        <span className="font-bold">#{String(id)}</span>
                    </p>
                    <p>
                        Date :{" "}
                        <span className="font-bold">
                            {formatDate(created_at)}
                        </span>
                    </p>
                    <p>
                        Time :{" "}
                        <span className="font-bold">
                            {formatTime(created_at)}
                        </span>
                    </p>
                </div>
            </div>

            <div className="border-b border-gray-300 mb-4" />

            {/* ── Customer & Agent ── */}
            <div className="flex mb-4">
                <div className="flex-1 pr-4 border-r border-gray-300">
                    <span className="bg-[#0f1f3d] text-white text-[10px] font-bold uppercase px-1.5 py-0.5">
                        Customer:
                    </span>
                    <p className="text-[#0f1f3d] font-bold text-sm mt-1">
                        {customer.name}
                    </p>
                    {customer.address && (
                        <p className="text-xs text-gray-600">
                            {customer.address}
                        </p>
                    )}
                    {customer.contact && (
                        <p className="text-xs text-gray-600">
                            {customer.contact}
                        </p>
                    )}
                </div>
                <div className="flex-1 pl-4">
                    <span className="bg-[#0f1f3d] text-white text-[10px] font-bold uppercase px-1.5 py-0.5">
                        Agent:
                    </span>
                    <p className="text-[#0f1f3d] font-bold text-sm mt-1">
                        {agent.username}
                    </p>
                    {agent.contact && (
                        <p className="text-xs text-gray-600">{agent.contact}</p>
                    )}
                </div>
            </div>

            {/* ── Items Table ── */}
            <div className="border border-[#0f1f3d] mb-4 overflow-x-auto">
                <div className="flex bg-[#0f1f3d] py-2 px-1">
                    <p className="w-[30%] text-center text-white text-[10px] font-bold">
                        Item
                    </p>
                    <p className="w-[22%] text-center text-white text-[10px] font-bold">
                        Size
                    </p>
                    <p className="w-[18%] text-center text-white text-[10px] font-bold">
                        Price
                    </p>
                    <p className="w-[12%] text-center text-white text-[10px] font-bold">
                        Qty
                    </p>
                    <p className="w-[18%] text-center text-white text-[10px] font-bold">
                        Amount
                    </p>
                </div>

                {items.map((item, idx) => {
                    const pieceCount = item.piece_count || 1;
                    const totalPieces = item.quantity * pieceCount;
                    const itemPrice = parseFloat(String(item.item_price)) || 0;
                    const amount = itemPrice * item.quantity * pieceCount;

                    return (
                        <div
                            key={item.id}
                            className={`flex border-b border-dashed border-gray-300 py-2 px-1 items-center ${
                                idx % 2 === 1 ? "bg-gray-50" : ""
                            }`}
                        >
                            <div className="w-[30%] text-center">
                                <p className="text-[10px] text-gray-800">
                                    {item.size_group}
                                </p>
                            </div>
                            <p className="w-[22%] text-center text-[10px] text-gray-800">
                                {item.size_group}
                            </p>
                            <p className="w-[18%] text-center text-[10px] text-gray-800">
                                Rs. {itemPrice.toFixed(2)}/pc
                            </p>
                            <div className="w-[12%] text-center">
                                <p className="text-[10px] text-gray-800">
                                    {item.quantity}
                                </p>
                                {pieceCount > 1 && (
                                    <p className="text-[9px] text-gray-500">
                                        ×{pieceCount}={totalPieces}pc
                                    </p>
                                )}
                            </div>
                            <p className="w-[18%] text-center text-[10px] text-gray-800">
                                Rs. {amount.toLocaleString("en-IN")}
                            </p>
                        </div>
                    );
                })}
            </div>

            <div className="flex justify-between">
                {/* ── Total Pieces ── */}
                <div className="flex justify-start shrink">
                    <span className="text-xs text-[#0f1f3d] font-bold">
                        TOTAL PIECES: {totalPieces}
                    </span>
                </div>
                <div>
                    {/* ── Total ── */}
                    <div className="flex flex-col items-end">
                        <div className="flex items-center mb-1">
                            <span className="text-[#0f1f3d] text-xs font-bold px-3 py-1">
                                SUBTOTAL:
                            </span>
                            <div className="px-4 py-1 min-w-[100px] text-right">
                                <p className="text-gray-700 text-xs font-bold">
                                    Rs. {total_price.toLocaleString("en-IN")}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center mb-1">
                            <span className="text-[#0f1f3d] text-xs font-bold px-3 py-1">
                                GST @ {gst_rate}%:
                            </span>
                            <div className="px-4 py-1 min-w-[100px] text-right">
                                <p className="text-gray-700 text-xs font-bold">
                                    Rs.{" "}
                                    {gstAmount.toLocaleString("en-IN", {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                    })}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center">
                            <span className="border border-[#0f1f3d] bg-[#0f1f3d] text-white text-sm font-bold px-4 py-2">
                                TOTAL:
                            </span>
                            <div className="border border-[#0f1f3d] px-4 py-2 min-w-[100px] text-right">
                                <p className="text-[#0f1f3d] text-sm font-bold">
                                    Rs.{" "}
                                    {totalWithGst.toLocaleString("en-IN", {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                    })}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Footer ── */}
            <div className="flex justify-center items-center mt-8">
                <div className="flex-1 border-b border-gray-400 mb-1" />
                <p className="text-sm text-gray-600 italic px-4">
                    Thank you for your business!
                </p>
                <div className="flex-1 border-b border-gray-400 mb-1" />
            </div>
        </div>
    );
}
