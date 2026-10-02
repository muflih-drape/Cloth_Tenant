"use client";

import { Info, RotateCcw, TrendingDown, TrendingUp } from "lucide-react";

interface RateOverrideSelectorProps {
    /** The fabric's catalogue rate — what every other customer pays. */
    catalogRate: string;
    /** Held as a string so a half-rupee rate is never rounded away mid-typing. */
    value: string;
    onChange: (rate: string) => void;
    /** An admin may bill above catalogue; an agent may only discount. */
    canRaiseRate?: boolean;
    /** True once this line already carries an agreed rate. */
    isOverridden?: boolean;
}

const rupees = (raw: string) =>
    Number(raw || 0).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });

/** Two rates are the same money when they agree to the paisa. */
const sameRate = (a: string, b: string) =>
    Number(a || 0).toFixed(2) === Number(b || 0).toFixed(2);

export default function RateOverrideSelector({
    catalogRate,
    value,
    onChange,
    canRaiseRate,
    isOverridden,
}: RateOverrideSelectorProps) {
    const overridden = !sameRate(value, catalogRate);
    const difference = Number(value || 0) - Number(catalogRate || 0);
    const tooHigh = !canRaiseRate && difference > 0;

    return (
        <div className="mb-4 bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm">
            <div className="flex items-center justify-between">
                <h3 className="font-bold text-gray-900">Rate per metre</h3>
                <span className="text-xs text-gray-400 font-medium">
                    Catalogue ₹{rupees(catalogRate)}/m
                </span>
            </div>

            <div className="mt-4 flex items-baseline gap-1.5">
                <span className="text-sm font-bold text-gray-400">₹</span>
                <input
                    type="number"
                    inputMode="decimal"
                    step={0.5}
                    min={0}
                    aria-label="Rate per metre"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    className="w-32 h-12 rounded-xl border border-gray-100 text-center text-2xl font-black text-gray-900 focus:outline-none focus:border-gray-400 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-sm font-bold text-gray-400">/m</span>
            </div>

            {overridden && (
                <div className="mt-4 flex items-center justify-between gap-3">
                    <span
                        className={`flex items-center gap-1.5 text-xs font-bold ${
                            difference < 0 ? "text-green-600" : "text-amber-600"
                        }`}
                    >
                        {difference < 0 ? (
                            <TrendingDown size={14} className="shrink-0" />
                        ) : (
                            <TrendingUp size={14} className="shrink-0" />
                        )}
                        {difference < 0 ? "−" : "+"}₹
                        {rupees(String(Math.abs(difference)))} vs catalogue
                    </span>
                    <button
                        onClick={() => onChange(catalogRate)}
                        className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-gray-50 border border-gray-100 text-[11px] font-bold text-gray-500 hover:border-primary hover:text-primary transition-colors"
                    >
                        <RotateCcw size={12} />
                        Catalogue rate
                    </button>
                </div>
            )}

            <div className="mt-4 flex items-start gap-2 text-gray-400">
                <Info size={14} className="shrink-0 mt-0.5" />
                <p className="text-[11px] font-medium leading-relaxed">
                    {isOverridden
                        ? "This line is already priced at an agreed rate. Changing it here only affects this order."
                        : "Change this to price it for this customer only. The item keeps its catalogue rate for everyone else."}
                </p>
            </div>

            {tooHigh && (
                <p className="mt-3 text-[11px] font-bold uppercase tracking-wider text-rose-500">
                    An agent cannot charge more than the catalogue rate of ₹
                    {rupees(catalogRate)}/m
                </p>
            )}
        </div>
    );
}
