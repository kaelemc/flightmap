import type { FlightImage } from '../types';

function imageId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

const isDataImage = (v: unknown): v is string =>
  typeof v === 'string' && v.startsWith('data:image/');

/**
 * Normalise a stored/imported images value into FlightImage[]. Accepts the
 * current array-of-objects form, a bare array of data-URL strings, and the
 * legacy single `boardingPass` string (migrated with a "Boarding pass" label).
 */
export function coerceImages(
  images: unknown,
  legacyBoardingPass?: unknown
): FlightImage[] | undefined {
  const out: FlightImage[] = [];
  if (Array.isArray(images)) {
    for (const item of images) {
      if (isDataImage(item)) {
        out.push({ id: imageId(), data: item });
      } else if (item && typeof item === 'object') {
        const { id, data, label } = item as Record<string, unknown>;
        if (isDataImage(data)) {
          out.push({
            id: typeof id === 'string' && id ? id : imageId(),
            data,
            label: typeof label === 'string' && label ? label : undefined,
          });
        }
      }
    }
  }
  if (!out.length && isDataImage(legacyBoardingPass)) {
    out.push({ id: imageId(), data: legacyBoardingPass, label: 'Boarding pass' });
  }
  return out.length ? out : undefined;
}

/**
 * Downscale and JPEG-compress an image File into a data URL small enough to
 * live in localStorage next to the flight log. Boarding-pass photos off a
 * phone run to several megabytes; this brings them down to tens of KB while
 * keeping the pass legible. EXIF orientation is baked in so portrait phone
 * shots don't come back sideways.
 */
export async function compressImageFile(
  file: File,
  maxEdge = 1400,
  quality = 0.72
): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is unavailable in this browser.');
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    bitmap.close();
  }
}
