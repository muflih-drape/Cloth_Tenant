import { RefObject } from "react";
import { InvoiceResponse } from "@/lib/api/order";
import { formatMeters, toMeters } from "@/types/item";

/**
 * The printed order form only needs the invoice header and its lines. The
 * payable figure comes from `totals.effective_total`, which already has GST and
 * any override folded in, so the separate `gst_rate` is not used here.
 */
interface OrderFormProps
  extends Pick<
    InvoiceResponse,
    | "id"
    | "customer"
    | "agent"
    | "brand"
    | "created_at"
    | "items"
    | "totals"
    | "lr_number"
  > {
    invoiceRef?: RefObject<HTMLDivElement | null>;
}

const INK = "#0f1f3d";

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

const money = (value: string | number) =>
    Number(value || 0).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });

export default function OrderForm({
    id,
    customer,
    agent,
    brand,
    created_at,
    items,
    totals,
    invoiceRef,
    lr_number,
}: OrderFormProps) {
    // The API sends the effective total with any override and GST already
    // folded in, so the payable figure is used verbatim.
    const payable = Number(totals.effective_total || 0);
    const totalMetres = toMeters(totals.total_ordered_meters);
    const allocatedMetres = toMeters(totals.total_allocated_meters);
    const outstandingMetres = toMeters(totals.total_outstanding_meters);

    return (
        <div ref={invoiceRef} className="bg-white w-full">
            {/* ── Company Header ── */}
            <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 rounded overflow-hidden flex items-center justify-center bg-gray-100">
                    {brand?.logo_url ? (
                        <img
                            src={brand.logo_url}
                            alt="Company Logo"
                            className="w-12 h-12 object-cover rounded"
                        />
                    ) : (
                        <span className="text-[#0f1f3d] text-lg font-bold">
                            {(brand?.name ?? "BR").slice(0, 2).toUpperCase()}
                        </span>
                    )}
                </div>
                <div className="text-right">
                    <p className="text-[#0f1f3d] font-bold text-base">
                        {brand?.name ?? ""}
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
                        <p className="text-xs text-gray-600">GST : {brand.gst}</p>
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
                    {lr_number && (
                        <p>
                            LR No : <span className="font-bold">{lr_number}</span>
                        </p>
                    )}
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
                        {agent?.username ?? "—"}
                    </p>
                    {agent?.contact && (
                        <p className="text-xs text-gray-600">{agent.contact}</p>
                    )}
                </div>
            </div>

            {/* ── Fabric Lines ── */}
            <div className="border border-[#0f1f3d] mb-4 overflow-x-auto">
                <div className="flex bg-[#0f1f3d] py-2 px-1">
                    <p className="w-[30%] text-center text-white text-[10px] font-bold">
                        Fabric
                    </p>
                    <p className="w-[16%] text-center text-white text-[10px] font-bold">
                        Colour
                    </p>
                    <p className="w-[18%] text-center text-white text-[10px] font-bold">
                        Rate
                    </p>
                    <p className="w-[12%] text-center text-white text-[10px] font-bold">
                        Metres
                    </p>
                    <p className="w-[12%] text-center text-white text-[10px] font-bold">
                        Packed
                    </p>
                    <p className="w-[12%] text-center text-white text-[10px] font-bold">
                        Amount
                    </p>
                </div>

                {items.map((item, idx) => (
                    <div
                        key={item.id}
                        className={`flex border-b border-dashed border-gray-300 py-2 px-1 items-center ${
                            idx % 2 === 1 ? "bg-gray-50" : ""
                        }`}
                    >
                        <p className="w-[30%] text-center text-[10px] text-gray-800">
                            {item.fabric_name}
                        </p>
                        <p className="w-[16%] text-center text-[10px] text-gray-800">
                            {item.variant_display_order || "—"}
                        </p>
                        <p className="w-[18%] text-center text-[10px] text-gray-800">
                            Rs. {money(item.rate_per_meter)}/m
                        </p>
                        <p className="w-[12%] text-center text-[10px] text-gray-800">
                            {formatMeters(item.ordered_quantity)} m
                        </p>
                        <p className="w-[12%] text-center text-[10px] text-gray-800">
                            {formatMeters(item.allocated_quantity)} m
                        </p>
                        <p className="w-[12%] text-center text-[10px] text-gray-800">
                            Rs. {money(item.line_total)}
                        </p>
                    </div>
                ))}
            </div>

            <div className="flex justify-between">
                {/* ── Metre summary ── */}
                <div className="flex flex-col gap-1 shrink">
                    <span className="text-xs text-[#0f1f3d] font-bold">
                        TOTAL METRES: {formatMeters(totalMetres)} m
                    </span>
                    <span className="text-[10px] text-gray-600">
                        Packed: {formatMeters(allocatedMetres)} m
                        {outstandingMetres > 0 && (
                            <span className="text-amber-700 font-bold">
                                {" "}
                                · Awaiting packing: {formatMeters(outstandingMetres)}{" "}
                                m
                            </span>
                        )}
                    </span>
                </div>

                <div>
                    <div className="flex flex-col items-end">
                        {totals.final_total && (
                            <div className="flex items-center mb-1">
                                <span className="text-[#0f1f3d] text-xs font-bold px-3 py-1">
                                    COMPUTED:
                                </span>
                                <div className="px-4 py-1 min-w-[100px] text-right">
                                    <p className="text-gray-500 text-xs font-bold line-through">
                                        Rs. {money(totals.computed_total)}
                                    </p>
                                </div>
                            </div>
                        )}
                        <div className="flex items-center">
                            <span
                                className={`border px-4 py-2 text-sm font-bold ${
                                    totals.is_price_overridden
                                        ? "border-[#0f1f3d] bg-white text-[#0f1f3d]"
                                        : "border-[#0f1f3d] bg-[#0f1f3d] text-white"
                                }`}
                            >
                                {totals.is_price_overridden ? "ADJUSTED TOTAL:" : "TOTAL:"}
                            </span>
                            <div className="border border-[#0f1f3d] px-4 py-2 min-w-[100px] text-right">
                                <p className="text-[#0f1f3d] text-sm font-bold">
                                    Rs. {money(payable)}
                                </p>
                            </div>
                        </div>
                        {totals.is_price_overridden && totals.price_override_reason && (
                            <p
                                className="mt-1 text-[10px] text-gray-500 max-w-[220px] text-right"
                                style={{ color: INK }}
                            >
                                {totals.price_override_reason}
                            </p>
                        )}                    </div>
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
