export type SupportedImageMimeType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/gif';

export const SUPPORTED_IMAGE_MIME_TYPES: readonly SupportedImageMimeType[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];

export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_IMAGE_DIMENSION = 4096; // 4096px

export interface ImageReference {
  id: string;
  sourceType: 'data_url' | 'storage_uri';
  mimeType: SupportedImageMimeType;
  byteSize: number;
  dataUrl?: string;
  storageUri?: string;
  dimensions?: { width: number; height: number };
  createdAt: string;
}

export interface ImageValidationResult {
  valid: boolean;
  imageReference?: ImageReference;
  error?: string;
}

/**
 * Validates an uploaded image payload (Data URL or Storage URI).
 * Enforces MIME type, size limit, base64 integrity, and constructs canonical ImageReference.
 */
export function validateImageUpload(imagePayload: unknown): ImageValidationResult {
  if (!imagePayload || typeof imagePayload !== 'string') {
    return { valid: false, error: 'Image payload must be a non-empty string' };
  }

  const trimmed = imagePayload.trim();

  // 1. Data URL validation
  if (trimmed.startsWith('data:')) {
    const headerEnd = trimmed.indexOf(',');
    if (headerEnd === -1) {
      return { valid: false, error: 'Malformed Data URL: missing base64 separator comma' };
    }

    const header = trimmed.substring(5, headerEnd);
    const [mimePart, encPart] = header.split(';');

    if (encPart !== 'base64') {
      return { valid: false, error: 'Malformed Data URL: only base64 encoding is supported' };
    }

    const mime = mimePart.toLowerCase() as SupportedImageMimeType;
    if (!SUPPORTED_IMAGE_MIME_TYPES.includes(mime)) {
      return {
        valid: false,
        error: `Unsupported image MIME type '${mime}'. Supported types: ${SUPPORTED_IMAGE_MIME_TYPES.join(', ')}`,
      };
    }

    const base64Data = trimmed.substring(headerEnd + 1);

    // Approximate byte length from base64 string
    const padding = (base64Data.match(/=+$/) || [''])[0].length;
    const byteSize = Math.floor((base64Data.length * 3) / 4) - padding;

    if (byteSize > MAX_IMAGE_SIZE_BYTES) {
      return {
        valid: false,
        error: `Image size (${Math.round(byteSize / 1024 / 1024)}MB) exceeds maximum limit of 10MB`,
      };
    }

    // Check base64 valid characters
    if (!/^[A-Za-z0-9+/=]+$/.test(base64Data.slice(0, 1000))) {
      return { valid: false, error: 'Malformed base64 character encoding in image data' };
    }

    const id = 'img_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);

    return {
      valid: true,
      imageReference: {
        id,
        sourceType: 'data_url',
        mimeType: mime,
        byteSize,
        dataUrl: trimmed,
        createdAt: new Date().toISOString(),
      },
    };
  }

  // 2. Storage URI validation (e.g. s3:// or https://...)
  if (trimmed.startsWith('https://') || trimmed.startsWith('s3://')) {
    const ext = trimmed.split('.').pop()?.toLowerCase();
    let mime: SupportedImageMimeType = 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';
    else if (ext === 'webp') mime = 'image/webp';
    else if (ext === 'gif') mime = 'image/gif';

    const id = 'img_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);

    return {
      valid: true,
      imageReference: {
        id,
        sourceType: 'storage_uri',
        mimeType: mime,
        byteSize: 0,
        storageUri: trimmed,
        createdAt: new Date().toISOString(),
      },
    };
  }

  return { valid: false, error: 'Unrecognized image payload format; must be data:image/* base64 URL or HTTPS URI' };
}
