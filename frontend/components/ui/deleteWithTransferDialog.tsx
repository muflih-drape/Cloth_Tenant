"use client";

import { useState, useEffect } from "react";
import { Trash2, X, ShieldAlert } from "lucide-react";
import StockFlowSelect from "@/components/ui/custom/stockFlowSelect";
import { PageLoading } from "./Loading";

type EntityType = "agent" | "customer" | "brand";

interface EntityConfig {
    title: string;
    description: string;
    summaryLine: (counts: Record<string, number>) => string;
    counts: { key: string; label: string }[];
    showTransfer: boolean;
    transferLabel: string;
    deactivateLabel: string;
}

const ENTITY_CONFIGS: Record<EntityType, EntityConfig> = {
    agent: {
        title: "Delete Agent",
        description: "This will also delete their user account.",
        summaryLine: (c) =>
            `This agent has ${c.customers_count} customers and ${c.orders_count} orders.`,
        counts: [
            { key: "customers_count", label: "Customers" },
            { key: "orders_count", label: "Orders" },
        ],
        showTransfer: true,
        transferLabel: "Transfer customers to another agent",
        deactivateLabel: "Keep historical references (Deactivate agent)",
    },
    customer: {
        title: "Delete Customer",
        description:
            "This customer will be deactivated. Orders will be preserved.",
        summaryLine: (c) => `This customer has ${c.orders_count} orders.`,
        counts: [{ key: "orders_count", label: "Orders" }],
        showTransfer: false,
        transferLabel: "",
        deactivateLabel: "Keep historical references (Deactivate customer)",
    },
    brand: {
        title: "Delete Brand",
        description: "Items and users referencing this brand will be affected.",
        summaryLine: (c) =>
            `This brand has ${c.items_count} items and ${c.users_count} users.`,
        counts: [
            { key: "items_count", label: "Items" },
            { key: "users_count", label: "Users" },
        ],
        showTransfer: true,
        transferLabel: "Transfer items to another brand",
        deactivateLabel: "Keep historical references (Deactivate brand)",
    },
};

interface DeleteWithTransferDialogProps {
    open: boolean;
    onClose: () => void;
    entityType: EntityType;
    entityId: number;
    entityName: string;
    onFetchDeleteInfo: (id: number) => Promise<Record<string, any>>;
    onDelete: (
        id: number,
        payload: {
            pin: string;
            action: "transfer" | "deactivate";
            transfer_to_id?: number;
        },
    ) => Promise<void>;
    isSuperuser?: boolean;
}

export default function DeleteWithTransferDialog({
    open,
    onClose,
    entityType,
    entityId,
    entityName,
    onFetchDeleteInfo,
    onDelete,
    isSuperuser = false,
}: DeleteWithTransferDialogProps) {
    const config = ENTITY_CONFIGS[entityType];

    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(true);
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [transferOptions, setTransferOptions] = useState<
        { value: string; label: string }[]
    >([]);
    const [action, setAction] = useState<"transfer" | "deactivate">(
        "deactivate",
    );
    const [transferToId, setTransferToId] = useState("");
    const [pin, setPin] = useState(["", "", "", "", "", ""]);
    const [pinError, setPinError] = useState("");
    const [error, setError] = useState("");

    useEffect(() => {
        if (!open) return;
        setFetching(true);
        setError("");
        setPin(["", "", "", "", "", ""]);
        setPinError("");
        setAction("deactivate");
        setTransferToId("");
        onFetchDeleteInfo(entityId)
            .then((data) => {
                setCounts(data);
                if (config.showTransfer) {
                    const transferKey =
                        entityType === "agent"
                            ? "transferable_agents"
                            : "transferable_brands";
                    const nameKey = entityType === "agent" ? "name" : "name";
                    const opts = (data[transferKey] || []).map((t: any) => ({
                        value: t.id.toString(),
                        label: t[nameKey],
                    }));
                    setTransferOptions(opts);
                }
            })
            .catch(() => setError("Failed to load delete info"))
            .finally(() => setFetching(false));
    }, [open, entityId, entityType, config.showTransfer, onFetchDeleteInfo]);

    if (!open) return null;

    const handlePinInput = (index: number, value: string) => {
        const digit = value.replace(/\D/g, "").slice(-1);
        if (!digit) return;
        const next = [...pin];
        next[index] = digit;
        setPin(next);
        setPinError("");
        if (index < 5) {
            const el = document.getElementById(
                `pin-${entityType}-${index + 1}`,
            );
            el?.focus();
        }
    };

    const handlePinKeyDown = (
        index: number,
        e: React.KeyboardEvent<HTMLInputElement>,
    ) => {
        if (e.key === "Backspace") {
            if (pin[index]) {
                const next = [...pin];
                next[index] = "";
                setPin(next);
            } else if (index > 0) {
                const next = [...pin];
                next[index - 1] = "";
                setPin(next);
                const el = document.getElementById(
                    `pin-${entityType}-${index - 1}`,
                );
                el?.focus();
            }
        } else if (e.key === "Enter") {
            handleConfirm();
        }
    };

    const handleConfirm = async () => {
        const fullPin = pin.join("");
        if (fullPin.length < 6) {
            setPinError("Please enter all 6 digits.");
            return;
        }
        if (action === "transfer" && config.showTransfer && !transferToId) {
            setError("Please select a target to transfer to.");
            return;
        }
        setLoading(true);
        setError("");
        try {
            await onDelete(entityId, {
                pin: fullPin,
                action,
                transfer_to_id: transferToId
                    ? parseInt(transferToId)
                    : undefined,
            });
            onClose();
        } catch (e: any) {
            const msg =
                e?.response?.data?.error ||
                e?.response?.data?.detail ||
                "An error occurred.";
            setError(msg);
            setPin(["", "", "", "", "", ""]);
        } finally {
            setLoading(false);
        }
    };

    const filledCount = pin.filter(Boolean).length;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
            onClick={(e) => {
                if (e.target === e.currentTarget && !loading) onClose();
            }}
        >
            <div className="w-full sm:max-w-md bg-white rounded-3xl shadow-2xl pb-safe overflow-hidden animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 duration-200">
                <div className="flex items-start justify-between px-6 pt-6 pb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-red-50 flex items-center justify-center flex-shrink-0">
                            <ShieldAlert className="w-5 h-5 text-red-500" />
                        </div>
                        <div>
                            <h2 className="text-base font-black text-gray-900">
                                {config.title}
                            </h2>
                            <p className="text-xs text-gray-400 mt-0.5">
                                {config.description}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={loading}
                        className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors flex-shrink-0 ml-2"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="h-px bg-gray-100 mx-6" />

                {fetching ? (
                    <PageLoading />
                ) : (
                    <div className="px-6 pt-5 pb-6 space-y-5">
                        <p className="text-sm font-semibold text-gray-700">
                            <span className="font-black text-gray-900">
                                {entityName}
                            </span>{" "}
                            — {config.summaryLine(counts)}
                        </p>

                        {config.showTransfer && (
                            <div className="space-y-3">
                                <label className="flex items-start gap-3 cursor-pointer">
                                    <input
                                        type="radio"
                                        name={`delete-action-${entityType}`}
                                        checked={action === "transfer"}
                                        onChange={() => {
                                            setAction("transfer");
                                            setError("");
                                        }}
                                        className="mt-0.5 accent-primary"
                                    />
                                    <div className="text-sm font-medium text-gray-800">
                                        {config.transferLabel}
                                    </div>
                                </label>

                                {action === "transfer" && (
                                    <div className="ml-7">
                                        <StockFlowSelect
                                            value={transferToId}
                                            onChange={(val) => {
                                                setTransferToId(val);
                                                setError("");
                                            }}
                                            options={transferOptions}
                                            placeholder={`Select ${entityType}...`}
                                            className="bg-white"
                                        />
                                    </div>
                                )}

                                <label className="flex items-start gap-3 cursor-pointer">
                                    <input
                                        type="radio"
                                        name={`delete-action-${entityType}`}
                                        checked={action === "deactivate"}
                                        onChange={() => {
                                            setAction("deactivate");
                                            setError("");
                                        }}
                                        className="mt-0.5 accent-primary"
                                    />
                                    <div className="text-sm font-medium text-gray-800">
                                        {config.deactivateLabel}
                                    </div>
                                </label>
                            </div>
                        )}

                        {!config.showTransfer && (
                            <p className="text-sm text-gray-500 bg-gray-50 rounded-xl p-3">
                                {config.deactivateLabel}. All historical data
                                will be preserved.
                            </p>
                        )}

                        <div className="h-px bg-gray-100" />
                        {!isSuperuser && (
                            <div className="flex flex-col gap-4">
                                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 text-center">
                                    Enter your 6-digit PIN to confirm
                                </p>

                                <div className="flex gap-2 justify-center">
                                    {pin.map((digit, i) => (
                                        <input
                                            key={i}
                                            id={`pin-${entityType}-${i}`}
                                            type="password"
                                            inputMode="numeric"
                                            maxLength={1}
                                            value={digit}
                                            onChange={(e) =>
                                                handlePinInput(
                                                    i,
                                                    e.target.value,
                                                )
                                            }
                                            onKeyDown={(e) =>
                                                handlePinKeyDown(i, e)
                                            }
                                            disabled={loading}
                                            className={`w-11 h-14 rounded-2xl border-2 text-center text-xl font-black bg-gray-50 outline-none transition-all
                          ${
                              pinError
                                  ? "border-red-300 bg-red-50 text-red-600"
                                  : digit
                                    ? "border-primary bg-primary/5 text-primary"
                                    : "border-gray-200 text-gray-800"
                          }
                          focus:border-primary focus:bg-primary/5
                          disabled:opacity-50`}
                                        />
                                    ))}
                                </div>
                                <div className="flex justify-center gap-1.5">
                                    {Array.from({ length: 6 }).map((_, i) => (
                                        <div
                                            key={i}
                                            className={`rounded-full transition-all duration-150 ${
                                                i < filledCount
                                                    ? "w-2 h-2 bg-primary"
                                                    : "w-1.5 h-1.5 bg-gray-200"
                                            }`}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        {error && (
                            <p className="text-center text-xs font-semibold text-red-500 bg-red-50 py-2 px-3 rounded-xl">
                                {error}
                            </p>
                        )}

                        {pinError && (
                            <p className="text-center text-xs font-semibold text-red-500 bg-red-50 py-2 px-3 rounded-xl">
                                {pinError}
                            </p>
                        )}

                        <div className="flex gap-3">
                            <button
                                onClick={onClose}
                                disabled={loading}
                                className="flex-1 h-12 rounded-2xl border-2 border-gray-200 text-sm font-bold text-gray-500 hover:bg-gray-50 transition-all active:scale-95 disabled:opacity-40"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleConfirm}
                                disabled={
                                    loading ||
                                    (!isSuperuser && filledCount < 6) ||
                                    (action === "transfer" &&
                                        config.showTransfer &&
                                        !transferToId)
                                }
                                className="flex-1 h-12 rounded-2xl bg-red-500 text-sm font-bold text-white flex items-center justify-center gap-2 hover:bg-red-600 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-red-500/20"
                            >
                                {loading ? (
                                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <>
                                        <Trash2 className="w-4 h-4" />
                                        {action === "transfer"
                                            ? "Transfer & Delete"
                                            : "Deactivate"}
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
