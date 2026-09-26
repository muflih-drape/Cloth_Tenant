"use client";

import { Info, Minus, Plus } from "lucide-react";

interface QuantitySelectorProps {
    quantity: number;
    availableStock: number;
    isEditMode?: boolean;
    onChange: (qty: number) => void;
}

export default function QuantitySelector({
    quantity,
    availableStock,
    onChange,
    isEditMode,
}: QuantitySelectorProps) {
    return (
        <div>
            {isEditMode && (
                <div className="mb-6 p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-center gap-3 text-amber-500 animate-in fade-in slide-in-from-top-2">
                    <Info size={32} />
                    <p className="text-sm font-bold">
                        This was ordered before. Editing here will update that
                        quantity
                    </p>
                </div>
            )}
            <div className="mb-10 bg-white p-6 rounded-[32px] border border-gray-100 flex items-center justify-between shadow-sm">
                <h3 className="font-bold text-gray-900">Quantity</h3>
                <div className="flex items-center gap-6">
                    <button
                        onClick={() => onChange(Math.max(1, quantity - 1))}
                        className="w-10 h-10 rounded-xl border border-gray-100 flex items-center justify-center text-gray-400 hover:bg-gray-50 active:scale-90 transition-all font-bold"
                    >
                        <Minus size={20} />
                    </button>

                    <input
                        type="number"
                        min={1}
                        value={quantity}
                        onChange={(e) =>
                            onChange(
                                Math.max(1, parseInt(e.target.value, 10) || 1),
                            )
                        }
                        onFocus={(e) => e.target.select()}
                        className="w-16 h-10 rounded-xl border border-gray-100 text-center text-xl font-black text-gray-900 focus:outline-none focus:border-gray-400 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />

                    <button
                        onClick={() =>
                            onChange(Math.min(availableStock, quantity + 1))
                        }
                        className="w-10 h-10 rounded-xl bg-gray-900 flex items-center justify-center text-white hover:bg-black active:scale-90 transition-all font-bold"
                    >
                        <Plus size={20} />
                    </button>
                </div>
            </div>
        </div>
    );
}
