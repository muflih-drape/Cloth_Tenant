"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PDFDocument, degrees } from "pdf-lib";

import { itemApi } from "@/lib/api/item";
import type { ItemQRResponse, ItemVariant } from "@/types/item";

import { pdf } from "@react-pdf/renderer";
import { QRLabelPdf } from "@/components/pages/items/qr/QRLabelPdf";

import QRCode from "qrcode";
import Image from "next/image";
import { ChevronLeft, Download, Printer, Share2 } from "lucide-react";
import { PageLoading } from "@/components/ui/Loading";
import { variantColorLabel } from "@/lib/colorLabel";

type QRPrintItem = {
    id: number;
    name: string;
    type: string;
    price: string;
    image: string | null;
    variants: ItemVariant[];
};

export default function QRPrintPageContent() {
    const searchParams = useSearchParams();

    const itemId = searchParams.get("item");
    const qrId = searchParams.get("qr");
    const variantId = searchParams.get("id");

    const router = useRouter();

    const [item, setItem] = useState<QRPrintItem | null>(null);
    const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
    const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
    const [qrImages, setQrImages] = useState<Record<number, string>>({});
    const [loading, setLoading] = useState(true);
    const [sharing, setSharing] = useState(false);
    const [printing, setPrinting] = useState(false);

    const isMobile =
        typeof window !== "undefined" &&
        /Mobi|Android/i.test(navigator.userAgent);

    useEffect(() => {
        const fetchData = async () => {
            try {
                if (itemId) {
                    const data = await itemApi.getOne(Number(itemId));
                    const variants = data.variants.map((v) => ({
                        id: v.id,
                        qr_code: v.qr_code,
                        image: v.image,
                        sizes: v.sizes,
                        display_order: v.display_order,
                    }));
                    const parsedItem: QRPrintItem = {
                        id: data.id,
                        name: data.name,
                        type: data.type || "gents",
                        price: data.price,
                        image: variants[0]?.image || null,
                        variants,
                    };
                    await prepareItem(parsedItem);
                } else if (qrId) {
                  const data: ItemQRResponse = await itemApi.byqr(qrId);
                    const matchedVariant =
                        data.variants.find((v) => v.qr_code === qrId) ||
                        data.variants[0];
                  const parsedItem: QRPrintItem = {
                        id: data.id,
                        name: data.name,
                        type: "gents",
                        price: data.price,
                        image: matchedVariant?.image || null,
                        variants: [matchedVariant],
                    };
                    await prepareItem(parsedItem);
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [itemId, qrId]);

    useEffect(() => {
        return () => {
            if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
        };
    }, [pdfBlobUrl]);

    const prepareItem = useCallback(
        async (parsedItem: QRPrintItem) => {
            setItem(parsedItem);

            const qrMap: Record<number, string> = {};
            for (const variant of parsedItem.variants) {
                qrMap[variant.id] = await QRCode.toDataURL(
                    variant.qr_code || String(variant.id),
                );
            }
            setQrImages(qrMap);

            // Generate initial blob
            const rawBlob = await pdf(
                <QRLabelPdf
                    item={parsedItem}
                    qrImages={qrMap}
                    id={variantId!}
                />,
            ).toBlob();

            // Bake 90° rotation into each page using pdf-lib
            const arrayBuffer = await rawBlob.arrayBuffer();
            const pdfDoc = await PDFDocument.load(arrayBuffer);
            for (const page of pdfDoc.getPages()) {
                page.setRotation(degrees(90));
            }
            const rotatedBytes = await pdfDoc.save();
            const blob = new Blob([new Uint8Array(rotatedBytes)], {
                type: "application/pdf",
            });
            setPdfBlob(blob);

            if (!isMobile) {
                setPdfBlobUrl(URL.createObjectURL(blob));
            }
        },
        [isMobile],
    );

    const handleDownload = () => {
        if (!pdfBlob || !item) return;
        const url = URL.createObjectURL(pdfBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${item.name}-${item.id}.pdf`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const handlePrint = async () => {
        if (!pdfBlob) return;
        setPrinting(true);
        try {
            const url = URL.createObjectURL(pdfBlob);

            if (isMobile) {
                // Mobile — open in new tab, user prints from browser menu
                window.open(url, "_blank");
                setTimeout(() => URL.revokeObjectURL(url), 60000);
            } else {
                // Desktop — silent print via hidden iframe
                const iframe = document.createElement("iframe");
                iframe.style.display = "none";
                iframe.src = url;
                document.body.appendChild(iframe);
                iframe.onload = () => {
                    iframe.contentWindow?.focus();
                    iframe.contentWindow?.print();
                    setTimeout(() => {
                        document.body.removeChild(iframe);
                        URL.revokeObjectURL(url);
                    }, 3000);
                };
            }
        } finally {
            setPrinting(false);
        }
    };

    const handleShare = async () => {
        if (!pdfBlob || !item) return;
        setSharing(true);
        try {
            const file = new File([pdfBlob], `${item.name}-${item.id}.pdf`, {
                type: "application/pdf",
            });

            if (navigator.canShare?.({ files: [file] })) {
                await navigator.share({
                    title: item.name,
                    text: `QR Labels for ${item.name}`,
                    files: [file],
                });
            } else {
                // Fallback — just download if share not supported
                handleDownload();
            }
        } catch (e) {
            if ((e as Error).name !== "AbortError") console.error(e);
        } finally {
            setSharing(false);
        }
    };

    if (loading || !item) {
        return <PageLoading />;
    }

    return (
        <main className="h-screen flex flex-col">
            {/* Header */}
            <header className="w-full flex items-center p-4">
                <button
                    onClick={() => router.push("/admin/items")}
                    className="flex items-center gap-1.5"
                >
                    <ChevronLeft className="w-7 h-7" />
                    Back
                </button>
            </header>

            {/* Preview Area */}
            <div className="flex-1 overflow-y-auto p-4">
                {isMobile ? (
                    // Mobile — iframe doesn't work, show card preview instead
                    <div className="flex flex-col gap-3 items-center pb-4">
                        {item.variants.map((variant, index) => (
                            <div
                                key={variant.id}
                                className="gap-4 bg-white border shadow-sm flex flex-col items-center justify-center w-full max-w-sm min-h-[150mm] px-4 py-6"
                            >
                                <p className="text-[24px] font-bold text-center">
                                    {item.name}
                                </p>
                                <p className="text-[18px] bg-gray-100 px-2 py-1 rounded">
                                    {variantColorLabel(variant.display_order, index + 1)}
                                </p>
                                <Image
                                    src={qrImages[variant.id]}
                                    unoptimized
                                    alt="QR Code"
                                    width={150}
                                    height={150}
                                    className="mt-3"
                                />
                                <p className="text-[24px] font-extrabold">
                                    Rs. {Number(item.price).toFixed(2)}
                                </p>
                            </div>
                        ))}
                    </div>
                ) : (
                    <iframe
                        src={pdfBlobUrl ?? undefined}
                        className="w-full h-full border-0 bg-white"
                        title="QR Labels PDF Preview"
                    />
                )}
            </div>

            {/* Action Bar */}
            <div className="sticky bottom-0 p-4 bg-white border-t">
                <div className="flex gap-3 max-w-md mx-auto">
                    {/* Print — hidden on mobile since it opens a new tab */}

                    <button
                        onClick={handlePrint}
                        disabled={printing || !pdfBlob}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border border-gray-200 text-gray-700 rounded-2xl font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
                    >
                        <Printer size={18} />
                        {printing ? "Opening..." : "Print"}
                    </button>

                    {isMobile && (
                        <button
                            onClick={handleShare}
                            disabled={sharing || !pdfBlob}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border border-gray-200 text-gray-700 rounded-2xl font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
                        >
                            <Share2 size={18} />
                            {sharing ? "Sharing..." : "Share"}
                        </button>
                    )}

                    {/* Download */}
                    <button
                        onClick={handleDownload}
                        disabled={!pdfBlob}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-primary text-white rounded-2xl font-medium disabled:opacity-50 transition-colors"
                    >
                        <Download size={18} />
                        Download
                    </button>
                </div>
            </div>
        </main>
    );
}
