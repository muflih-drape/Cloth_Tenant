import { computeShrinkSize, JPEG_QUALITY } from "./image-resize";

export const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", (error) => reject(error));
    image.setAttribute("crossOrigin", "anonymous");
    image.src = url;
  });

/**
 * Downscale an image file so its longest side is at most MAX_UPLOAD_SIDE.
 * Returns the original file when it is already small enough or when the
 * browser cannot decode it (callers keep working, the server resizes anyway).
 */
export async function shrinkImageFile(file: File): Promise<File> {
  if (typeof document === "undefined" || !file.type.startsWith("image/")) {
    return file;
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await createImage(url);
    const { width, height, scaled } = computeShrinkSize(
      image.naturalWidth,
      image.naturalHeight,
    );
    if (!scaled) return file;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, width, height);

    const transparent = file.type === "image/png" || file.type === "image/webp";
    const mime = transparent ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mime, transparent ? undefined : JPEG_QUALITY),
    );
    if (!blob) return file;

    const ext = transparent ? "png" : "jpg";
    return new File([blob], file.name.replace(/\.[^.]+$/, `.${ext}`), {
      type: mime,
    });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function getCroppedImg(
  imageSrc: string,
  pixelCrop: { x: number; y: number; width: number; height: number },
  fileName: string = "cropped-image.jpg",
): Promise<File> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get context");
  }
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height,
  );
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Canvas is empty"));
        return;
      }
      resolve(new File([blob], fileName, { type: "image/jpeg" }));
    }, "image/jpeg");
  });
}

const isActuallyHeic = async (file: File): Promise<boolean> => {
  const buffer = await file.slice(0, 12).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const ftyp = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  return ftyp === "ftyp";
};

export const normalizeImageFile = async (file: File): Promise<File> => {
  const looksLikeHeic =
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    file.name.toLowerCase().endsWith(".heic") ||
    file.name.toLowerCase().endsWith(".heif");

  if (looksLikeHeic && (await isActuallyHeic(file))) {
    const heic2any = (await import("heic2any")).default;
    const converted = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: 1,
    });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    return shrinkImageFile(
      new File([blob], file.name.replace(/\.(heic|heif)$/i, ".jpg"), {
        type: "image/jpeg",
      }),
    );
  }

  return shrinkImageFile(file);
};
