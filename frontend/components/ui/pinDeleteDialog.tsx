"use client";

import { useState, useRef, useEffect } from "react";
import { Trash2, X, ShieldAlert } from "lucide-react";

interface PinDeleteDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (pin: string) => Promise<void>;
  title?: string;
  description?: string;
}

export default function PinDeleteDialog({
  open,
  onClose,
  onConfirm,
  title = "Confirm Delete",
  description = "This action cannot be undone.",
}: PinDeleteDialogProps) {
  const [pin, setPin] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setPin(["", "", "", "", "", ""]);
      setError("");
      setLoading(false);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    }
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === "Backspace") {
      if (pin[index]) {
        // Clear current cell
        const next = [...pin];
        next[index] = "";
        setPin(next);
        setError("");
      } else if (index > 0) {
        // Move back and clear previous
        const next = [...pin];
        next[index - 1] = "";
        setPin(next);
        inputRefs.current[index - 1]?.focus();
        setError("");
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < 5) {
      inputRefs.current[index + 1]?.focus();
    } else if (e.key === "Enter") {
      handleConfirm();
    }
  };

  const handleInput = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    if (!digit) return;

    const next = [...pin];
    next[index] = digit;
    setPin(next);
    setError("");

    if (index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, 6);
    if (!pasted) return;
    const next = [...pin];
    pasted.split("").forEach((digit, i) => {
      if (i < 6) next[i] = digit;
    });
    setPin(next);
    const focusIndex = Math.min(pasted.length, 5);
    inputRefs.current[focusIndex]?.focus();
  };

  const handleConfirm = async () => {
    const fullPin = pin.join("");
    if (fullPin.length < 6) {
      setError("Please enter all 6 digits.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await onConfirm(fullPin);
      onClose();
    } catch (e: any) {
      const msg =
        e?.response?.data?.error ||
        e?.response?.data?.detail ||
        "Incorrect PIN. Try again.";
      setError(msg);
      // Shake + clear PIN on wrong PIN
      setPin(["", "", "", "", "", ""]);
      setTimeout(() => inputRefs.current[0]?.focus(), 50);
    } finally {
      setLoading(false);
    }
  };

  const filledCount = pin.filter(Boolean).length;

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      {/* Sheet on mobile, centered card on sm+ */}
      <div className="w-full sm:max-w-sm bg-white rounded-3xl shadow-2xl pb-safe overflow-hidden animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 duration-200">
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-red-50 flex items-center justify-center flex-shrink-0">
              <ShieldAlert className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <h2 className="text-base font-black text-gray-900">{title}</h2>
              <p className="text-xs text-gray-400 mt-0.5">{description}</p>
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

        {/* PIN section */}
        <div className="px-6 pt-5 pb-6">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4 text-center">
            Enter your 6-digit PIN
          </p>

          {/* PIN inputs */}
          <div className="flex gap-2 justify-center mb-2" onPaste={handlePaste}>
            {pin.map((digit, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputRefs.current[i] = el;
                }}
                type="password"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleInput(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                disabled={loading}
                className={`w-11 h-14 rounded-2xl border-2 text-center text-xl font-black bg-gray-50 outline-none transition-all
                  ${
                    error
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

          <div className="flex justify-center gap-1.5 mb-4">
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

          {/* Error */}
          {error && (
            <p className="text-center text-xs font-semibold text-red-500 mb-4 bg-red-50 py-2 px-3 rounded-xl">
              {error}
            </p>
          )}

          {/* Buttons */}
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
              disabled={loading || filledCount < 6}
              className="flex-1 h-12 rounded-2xl bg-red-500 text-sm font-bold text-white flex items-center justify-center gap-2 hover:bg-red-600 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-red-500/20"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  Delete
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
