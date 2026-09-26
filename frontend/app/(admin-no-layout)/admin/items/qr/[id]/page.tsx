"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import QRCode from "react-qr-code";
import { itemApi } from "@/lib/api/item";
import type { ItemQRResponse } from "@/types/item";

const QRPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<ItemQRResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const hasPrinted = useRef(false);

  useEffect(() => {
    itemApi
      .byqr(id)
      .then(setItem)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  // Auto-print once data is ready, then close the tab when done
  useEffect(() => {
    if (!loading && item && !hasPrinted.current) {
      hasPrinted.current = true;
      setTimeout(() => {
        document.title = `${item.name}-${item.id}`.replace(/\s+/g, "-");
        window.print();
        // Fires after the print dialog is closed (whether printed or cancelled)
        window.onafterprint = () => window.close();
      }, 300);
    }
  }, [loading, item]);

  if (loading || !item) return null;

  // Find the specific variant this QR belongs to
  const variant = item.variants.find((v) => v.qr_code === id);
  const variantLabel = variant ? `Variant #${variant.id}` : "";

  return (
    <>
      {/* ── Print styles ── */}
      <style>{`
        @page {
          size: 58mm 90mm;
          margin: 0;
        }
        * { box-sizing: border-box; }
        body { margin: 0; background: white; }
        @media print {
          html, body { width: 58mm; height: 90mm; }
        }
      `}</style>

      {/* ── Card ── */}
      <div
        style={{
          width: "58mm",
          height: "90mm",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
          padding: "6mm 4mm",
          background: "white",
          fontFamily: "system-ui, sans-serif",
          margin: "0 auto",
        }}
      >
        {/* Item name */}
        <p
          style={{
            fontSize: "11px",
            fontWeight: 700,
            textAlign: "center",
            margin: 0,
            lineHeight: 1.2,
            letterSpacing: "-0.01em",
          }}
        >
          {item.name}
        </p>

        {/* QR code */}
        <div style={{ padding: "4px", background: "white" }}>
          <QRCode value={id} size={130} />
        </div>

        {/* Variant label e.g. "Round-Neck Tee #1" */}
        <p
          style={{
            fontSize: "9px",
            fontWeight: 600,
            color: "#555",
            textAlign: "center",
            margin: 0,
            background: "#f0f0f0",
            borderRadius: "4px",
            padding: "2px 8px",
            letterSpacing: "0.02em",
          }}
        >
          {variantLabel}
        </p>

        {/* Price */}
        <p
          style={{
            fontSize: "14px",
            fontWeight: 800,
            margin: 0,
            letterSpacing: "-0.02em",
          }}
        >
          ₹{parseFloat(item.price).toFixed(2)}
        </p>
      </div>
    </>
  );
};

export default QRPage;
