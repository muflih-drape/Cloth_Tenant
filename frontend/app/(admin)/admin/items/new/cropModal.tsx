"use client";

import { useState, useCallback } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import { X, Check } from "lucide-react";
import { getCroppedFile, getFitFile } from "@/lib/crop-utils";
import Image from "next/image";

interface Props {
    src: string;
    onConfirm: (file: File) => void;
    onCancel: () => void;
}

const ASPECTS = [
    { label: "Full", value: null },
    { label: "1:1", value: 1 },
    { label: "3:4", value: 3 / 4 },
];

export default function CropModal({ src, onConfirm, onCancel }: Props) {
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(
        null,
    );
    const [aspect, setAspect] = useState<number | null>(null);

    const onCropComplete = useCallback((_: Area, pixels: Area) => {
        setCroppedAreaPixels(pixels);
    }, []);

    const handleConfirm = async () => {
        if (aspect === null) {
            const file = await getFitFile(src);
            onConfirm(file);
            return;
        }
        if (!croppedAreaPixels) return;
        const file = await getCroppedFile(src, croppedAreaPixels);
        onConfirm(file);
    };

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-white overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-12 pb-4 flex-shrink-0">
                <button
                    type="button"
                    onClick={onCancel}
                    className="w-12 h-12 flex items-center justify-center rounded-full bg-black/10 text-black"
                >
                    <X size={24} />
                </button>
                <button
                    type="button"
                    onClick={handleConfirm}
                    className="flex items-center gap-1.5 bg-black text-white rounded-md px-4 py-1.5 text-lg font-bold"
                >
                    <Check size={24} />
                    Use Photo
                </button>
            </div>

            {/* Crop area */}
            <div className="relative flex-1 min-h-0 w-full">
                {aspect === null ? (
                    <div className="relative w-full h-full flex items-center justify-center">
                        <Image
                            src={src}
                            alt="Preview"
                            fill
                            className="object-contain"
                        />
                    </div>
                ) : (
                    <Cropper
                        image={src}
                        crop={crop}
                        zoom={zoom}
                        aspect={aspect}
                        onCropChange={setCrop}
                        onZoomChange={setZoom}
                        onCropComplete={onCropComplete}
                        style={{ containerStyle: { background: "#ffffff" } }}
                    />
                )}
            </div>

            {/* Aspect ratio picker + zoom */}
            <div className="flex flex-col gap-3 px-6 py-8">
                {/* Zoom slider — only when cropping */}
                {aspect !== null && (
                    <div className="flex items-center gap-3 py-2">
                        <button
                            type="button"
                            onClick={() =>
                                setZoom((z) =>
                                    Math.max(1, +(z - 0.1).toFixed(2)),
                                )
                            }
                            className="text-black/60 active:text-black"
                        >
                            <span className="text-lg leading-none">−</span>
                        </button>
                        <input
                            type="range"
                            min={1}
                            max={3}
                            step={0.05}
                            value={zoom}
                            onChange={(e) => setZoom(Number(e.target.value))}
                            className="flex-1 accent-black h-1"
                        />
                        <button
                            type="button"
                            onClick={() =>
                                setZoom((z) =>
                                    Math.min(3, +(z + 0.1).toFixed(2)),
                                )
                            }
                            className="text-black/60 active:text-black"
                        >
                            <span className="text-lg leading-none">+</span>
                        </button>
                    </div>
                )}

                {/* Aspect buttons */}
                <div className="flex items-center justify-center gap-2">
                    {ASPECTS.map((a) => (
                        <button
                            key={a.label}
                            type="button"
                            onClick={() => setAspect(a.value)}
                            className={`px-4 py-1.5 rounded-md text-lg font-semibold transition-colors ${
                                aspect === a.value
                                    ? "bg-black text-white"
                                    : "bg-black/10 text-black/60"
                            }`}
                        >
                            {a.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
