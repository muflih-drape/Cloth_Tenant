"use client";

import { useState } from "react";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogPortal,
  DialogOverlay,
  DialogTitle,
} from "@/components/ui/dialog";
import { Search } from "lucide-react";
import ShareImageButton from "../ui/custom/ShareImageButton";

interface ImagePreviewProps {
  src: string;
  alt?: string;
  enlargeDisabled?: boolean;
}

export function ImagePreview({
  src,
  alt = "Image",
  enlargeDisabled = false,
}: ImagePreviewProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {enlargeDisabled ? (
        <div
          className="relative cursor-pointer group w-full h-full"
          aria-label={alt}
        >
          <div className="relative w-full h-full">
            <Image
              src={src}
              alt={alt}
              fill
              priority
              loading="eager"
              className="object-cover"
              unoptimized
            />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            if (enlargeDisabled) return;
            e.stopPropagation();
            setOpen(true);
          }}
          className="relative cursor-pointer group w-full h-full"
          aria-label={`View ${alt} larger`}
        >
          <div className="relative w-full h-full touch-action-none">
            <Image
              src={src}
              alt={alt}
              fill
              priority
              loading="eager"
              className="object-cover"
              unoptimized
            />
          </div>
          {!enlargeDisabled && (
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center rounded-md">
              <Search
                size={20}
                className="text-white opacity-0 group-hover:opacity-100 transition-opacity"
              />
            </div>
          )}
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPortal >
          <DialogOverlay className="bg-white" />
          <DialogContent src={src} className="bg-transparent border-none shadow-none p-0 w-screen h-screen max-w-none flex items-center justify-center">
            <DialogTitle className="sr-only">{alt}</DialogTitle>
            <div className="relative w-full h-full">
              <Image
                src={src}
                alt={alt}
                fill
                className="object-contain rounded-lg w-full"
                unoptimized
              />
            </div>
          </DialogContent>
        </DialogPortal>
      </Dialog>
    </>
  );
}
