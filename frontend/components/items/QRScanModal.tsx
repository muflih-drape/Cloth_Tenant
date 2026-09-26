"use client";

import { useRef, useState } from "react";
import { Scanner } from "@yudiel/react-qr-scanner";
import { X, Camera } from "lucide-react";

interface QRScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (qr: string) => void;
}

const SCAN_COOLDOWN_MS = 1500;

export default function QRScanModal({
  isOpen,
  onClose,
  onScan,
}: QRScanModalProps) {
  const [manualInput, setManualInput] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);
  const lastScanRef = useRef({ code: "", at: 0 });

  if (!isOpen) return null;

  const playBeep = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

      // Low, punchy fundamental tone
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "square"; // fuller/heavier than sine
      osc1.frequency.value = 440; // lower pitch = heavier feel
      gain1.gain.setValueAtTime(0.3, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);

      // Slight higher layer for "click" presence
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "square";
      osc2.frequency.value = 660;
      gain2.gain.setValueAtTime(0.15, ctx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);

      osc1.start();
      osc2.start();
      osc1.stop(ctx.currentTime + 0.2);
      osc2.stop(ctx.currentTime + 0.15);
    } catch (e) {
      console.error("Beep failed:", e);
    }
  };

  const acceptScan = (rawValue: string) => {
    const now = Date.now();
    if (
      rawValue === lastScanRef.current.code &&
      now - lastScanRef.current.at < SCAN_COOLDOWN_MS
    ) {
      return;
    }
    lastScanRef.current = { code: rawValue, at: now };
    playBeep();
    onScan(rawValue);
  };

  const handleScan = (data: { rawValue: string }[]) => {
    if (data[0]?.rawValue) {
      acceptScan(data[0].rawValue);
    }
  };


  const handleManualSubmit = () => {
    if (manualInput.trim()) {
      acceptScan(manualInput.trim());
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/80"
        onClick={onClose}
      />
      <div className="relative w-full max-w-sm mx-4 bg-white rounded-3xl overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Camera className="text-primary" size={20} />
            <span className="font-bold text-gray-900">Scan QR Code</span>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        <div className="p-4">
          <div className="relative aspect-square rounded-2xl overflow-hidden bg-gray-900 mb-4">
            <Scanner
              onScan={handleScan}
              constraints={{
                facingMode: "environment",
                width: { ideal: 1280 },
                height: { ideal: 720 },
              }}
              classNames={{
                container: "w-full h-full",
                video: "w-full h-full object-cover",
              }}
            />
          </div>

          <button
            onClick={() => setShowManualInput(!showManualInput)}
            className="w-full text-center text-sm text-gray-500 hover:text-primary transition-colors py-2"
          >
            {showManualInput ? "Hide manual input" : "Or enter QR manually"}
          </button>

          {showManualInput && (
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                placeholder="Enter QR code..."
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleManualSubmit()}
                className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
              <button
                onClick={handleManualSubmit}
                disabled={!manualInput.trim()}
                className="px-6 py-3 bg-primary text-white rounded-xl font-bold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Go
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
