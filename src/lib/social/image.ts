import { IMAGE_SRC_LIMIT, type PostImage } from "./types";

// Browser-only. Re-encoding through a canvas keeps posts small enough for localStorage and
// drops EXIF metadata (including GPS location) before anything is stored.
// When images move to object storage, this step stays as the client-side resize.

export const IMAGE_MAX_EDGE = 1080;
export const IMAGE_FILE_LIMIT = 15 * 1024 * 1024;

export type ImageProblem =
  "not-image" | "too-large" | "unreadable" | "too-heavy";

export class ImagePreparationError extends Error {
  constructor(readonly problem: ImageProblem) {
    super(problem);
  }
}

export async function prepareImage(file: File): Promise<PostImage> {
  if (!file.type.startsWith("image/"))
    throw new ImagePreparationError("not-image");
  if (file.size > IMAGE_FILE_LIMIT)
    throw new ImagePreparationError("too-large");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // e.g. HEIC in browsers that cannot decode it.
    throw new ImagePreparationError("unreadable");
  }
  const scale = Math.min(
    1,
    IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height),
  );
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new ImagePreparationError("unreadable");
  }
  // JPEG has no transparency; paper white reads better than black.
  context.fillStyle = "#fffdf7";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  let src = canvas.toDataURL("image/jpeg", 0.78);
  if (src.length > IMAGE_SRC_LIMIT) src = canvas.toDataURL("image/jpeg", 0.6);
  if (src.length > IMAGE_SRC_LIMIT)
    throw new ImagePreparationError("too-heavy");
  return { src, alt: "", width, height };
}
