import type { AttachmentRef } from "../../../shared/types";

/** Hard cap per-image so we don't blow the protocol channel. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Reads a `File` (image) into an `AttachmentRef` with inline base64 data. */
export async function fileToImageAttachment(file: File): Promise<AttachmentRef | undefined> {
  if (!file.type.startsWith("image/")) return undefined;
  if (file.size > MAX_IMAGE_BYTES) return undefined;
  const dataBase64 = await readAsBase64(file);
  return {
    kind: "image",
    mimeType: file.type,
    bytes: file.size,
    name: file.name || `image.${guessExt(file.type)}`,
    dataBase64,
  };
}

function guessExt(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "bin";
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("expected DataURL string"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Extract image files from a clipboard `paste` event. Returns the array of
 * dropped files (so callers can run them through `fileToImageAttachment`).
 */
export function imagesFromClipboard(e: ClipboardEvent): File[] {
  const out: File[] = [];
  const items = e.clipboardData?.items ?? [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === "file" && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) out.push(f);
    }
  }
  return out;
}

/** Extract image files from a drag-and-drop `drop` event. */
export function imagesFromDrop(e: DragEvent): File[] {
  const out: File[] = [];
  const dt = e.dataTransfer;
  if (!dt) return out;
  for (let i = 0; i < dt.files.length; i++) {
    const f = dt.files.item(i);
    if (f && f.type.startsWith("image/")) out.push(f);
  }
  return out;
}
