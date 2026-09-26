"use client";

import { AlertTriangle, Info, Minus, Plus } from "lucide-react";
import { formatMeters, toMeters } from "@/types/item";

interface MetresSelectorProps {
    /** Held as a string so a half-metre cut is never rounded away mid-typing. */
    metres: string;
    onChange: (metres: string) => void;
    onHandMetres: number;
    isEditMode?: boolean;
}

const STEP = 0.5;

const nudge = (raw: string, delta: number) => {
    const next = toMeters(raw) + delta;
    return next <= 0 ? "0" : String(Number(next.toFixed(3)));
};

export default function MetresSelector({
    metres,
    onChange,
    onHandMetres,
    isEditMode,
}: MetresSelectorProps) {
    const requested = toMeters(metres);
    const oversubscribed = requested > onHandMetres;

    return (
        <div>
            {isEditMode && (
                <div className="mb-6 p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-center gap-3 text-amber-600">
                    <Info size={18} className="shrink-0" />
                    <p className="text-xs font-bold uppercase tracking-wider">
                        This colour is already on the order. Saving changes that
                        line.
                    </p>
                </div>
            )}

            <div className="mb-4 bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm">
                <div className="flex items-center justify-between">
                    <h3 className="font-bold text-gray-900">Metres needed</h3>
                    <span className="text-xs text-gray-400 font-medium">
                        {formatMeters(onHandMetres)} m on hand
                    </span>
                </div>

                <div className="mt-4 flex items-center justify-between gap-4">
                    <button
                        onClick={() => onChange(nudge(metres, -STEP))}
                        disabled={requested <= 0}
                        className="w-11 h-11 rounded-xl border border-gray-100 flex items-center justify-center text-gray-400 hover:bg-gray-50 active:scale-90 transition-all font-bold disabled:opacity-40"
                    >
                        <Minus size={20} />
                    </button>

                    <div className="flex items-baseline gap-1.5">
                        <input
                            type="number"
                            inputMode="decimal"
                            step={STEP}
                            min={0}
                            value={metres}
                            onChange={(e) => onChange(e.target.value)}
                            onFocus={(e) => e.target.select()}
                            className="w-24 h-12 rounded-xl border border-gray-100 text-center text-2xl font-black text-gray-900 focus:outline-none focus:border-gray-400 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <span className="text-sm font-bold text-gray-400">m</span>
                    </div>

                    <button
                        onClick={() => onChange(nudge(metres, STEP))}
                        className="w-11 h-11 rounded-xl bg-gray-900 flex items-center justify-center text-white hover:bg-black active:scale-90 transition-all font-bold"
                    >
                        <Plus size={20} />
                    </button>
                </div>

                <div className="mt-4 flex gap-2">
                    {[5, 10, 25, 50].map((preset) => (
                        <button
                            key={preset}
                            onClick={() => onChange(String(preset))}
                            className="flex-1 py-1.5 rounded-lg bg-gray-50 border border-gray-100 text-[11px] font-bold text-gray-500 hover:border-primary hover:text-primary transition-colors"
                        >
                            {preset} m
                        </button>
                    ))}
                </div>
            </div>

            {oversubscribed && (
                <div className="mb-6 p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-start gap-3 text-amber-600">
                    <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                    <p className="text-xs font-bold uppercase tracking-wider leading-relaxed">
                        More than we hold ({formatMeters(requested)} m asked,{" "}
                        {formatMeters(onHandMetres)} m on hand). The order can
                        still go ahead — packing will allocate what is available
                        and the rest stays owed.
                    </p>
                </div>
            )}
        </div>
    );
}
