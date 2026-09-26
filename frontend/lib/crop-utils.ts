import type { Area } from "react-easy-crop";
import { computeShrinkSize, JPEG_QUALITY } from "./image-resize";

/**
 * Downscale a canvas in place (returns a new canvas) so its longest side is at
 * most MAX_UPLOAD_SIDE. Keeps uploads well under the proxy body limit.
 */
function shrinkCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
    const { width, height, scaled } = computeShrinkSize(
        canvas.width,
        canvas.height,
    );
    if (!scaled) return canvas;

    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(canvas, 0, 0, width, height);
    return out;
}

function hasTransparency(canvas: HTMLCanvasElement): boolean {
    const ctx = canvas.getContext("2d")!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 255) return true;
    }
    return false;
}

const toFile = (canvas: HTMLCanvasElement, suffix: string): Promise<File> => {
    const scaled = shrinkCanvas(canvas);
    const transparent = hasTransparency(scaled);
    const mime = transparent ? "image/png" : "image/jpeg";
    const quality = transparent ? undefined : JPEG_QUALITY; // PNG ignores quality
    const ext = transparent ? "png" : "jpg";

    return new Promise((resolve, reject) =>
        scaled.toBlob(
            (blob) =>
                blob
                    ? resolve(
                          new File(
                              [blob],
                              `img_${Date.now()}_${suffix}.${ext}`,
                              {
                                  type: mime,
                              },
                          ),
                      )
                    : reject(new Error("Canvas is empty")),
            mime,
            quality,
        ),
    );
};

export async function getCroppedFile(src: string, area: Area): Promise<File> {
    const img = await loadImage(src);
    const canvas = document.createElement("canvas");
    canvas.width = area.width;
    canvas.height = area.height;
    canvas
        .getContext("2d")!
        .drawImage(
            img,
            area.x,
            area.y,
            area.width,
            area.height,
            0,
            0,
            area.width,
            area.height,
        );
    return toFile(canvas, "crop");
}

export async function getFitFile(src: string): Promise<File> {
    const img = await loadImage(src);
    const max = 1200;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return toFile(canvas, "fit");
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = src;
    });
}
