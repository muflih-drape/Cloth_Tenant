"use client";

import { PackagePlus } from "lucide-react";
import { ImagePreview } from "@/components/pages/ImagePreview";

interface ProductImageProps {
  image: string | null | undefined;
  alt: string;
}

export default function ProductImage({ image, alt }: ProductImageProps) {
  return (
    <div className="bg-white rounded-[40px] overflow-hidden border-2 border-black mb-8 aspect-square relative">
      {image ? (
        <ImagePreview src={image} alt={alt} />
      ) : (
        <div className="w-full h-full bg-gray-50 flex items-center justify-center">
          <PackagePlus size={64} className="text-gray-200" />
        </div>
      )}
      <div className="absolute top-6 right-6 bg-white/90 backdrop-blur-md px-4 py-2 rounded-2xl shadow-sm border border-white/20">
        <span className="text-xs font-black uppercase tracking-widest text-primary">
          Live Preview
        </span>
      </div>
    </div>
  );
}
