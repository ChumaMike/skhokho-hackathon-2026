import { put } from "@vercel/blob";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — a phone photo of a product/service, not a press kit
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** Whether Vercel Blob is configured for this deployment. */
export function isBlobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

export class ImageUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageUploadError";
  }
}

/**
 * Uploads a product/service/logo image to Vercel Blob, namespaced under
 * the business (and a folder within it) so one owner can never overwrite
 * another's file even with a colliding filename. Graceful degradation:
 * without `BLOB_READ_WRITE_TOKEN` this throws a clear, catchable error
 * rather than failing deep inside the SDK — callers (dashboard/catalog/
 * actions.ts, dashboard/settings/actions.ts) treat an image as optional
 * and never let a failed upload block saving the rest of a form.
 */
export async function uploadCatalogImage(
  file: File,
  businessId: string,
  folder: "catalog" | "business" = "catalog",
): Promise<string> {
  if (!isBlobConfigured()) {
    throw new ImageUploadError("Image upload isn't set up for this site yet.");
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new ImageUploadError("Please upload a JPG, PNG, WEBP or GIF image.");
  }
  if (file.size > MAX_BYTES) {
    throw new ImageUploadError("That image is too large — please keep it under 5MB.");
  }

  const ext = file.type.split("/")[1] === "jpeg" ? "jpg" : file.type.split("/")[1];
  const key = `${folder}/${businessId}/${crypto.randomUUID()}.${ext}`;

  const blob = await put(key, file, { access: "public", addRandomSuffix: false });
  return blob.url;
}
