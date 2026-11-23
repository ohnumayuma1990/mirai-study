import { createError } from 'h3'
import { VisionIngestTypeSchema, type VisionIngestType } from '../../shared/schemas/vision'

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024 // 4MB
export const MAX_IMAGE_DIMENSION = 4096
export const MAX_IMAGE_PIXELS = 16_000_000 // 16MP

export type AllowedImageMime = 'image/jpeg' | 'image/png' | 'image/webp'

export interface ValidatedImageResult {
  mimeType: AllowedImageMime
  extension: 'jpg' | 'png' | 'webp'
  width: number
  height: number
  byteLength: number
}

const UUID_FILE_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i

function detectMimeByMagicBytes(buf: Buffer): AllowedImageMime | null {
  if (buf.length < 12) return null

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg'
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png'
  }

  // WEBP: RIFF....WEBP
  if (
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }

  return null
}

function extractPngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  return { width, height }
}

function extractJpegDimensions(buf: Buffer): { width: number; height: number } | null {
  let offset = 2
  while (offset + 4 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (offset < buf.length && buf[offset] === 0xff) {
      offset += 1
    }
    if (offset >= buf.length) break
    const marker = buf[offset]!
    offset += 1

    // Standalone markers without length
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue
    }
    if (offset + 2 > buf.length) break
    const segmentLength = buf.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > buf.length) break

    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)

    if (isSof && offset + 7 <= buf.length) {
      const height = buf.readUInt16BE(offset + 3)
      const width = buf.readUInt16BE(offset + 5)
      return { width, height }
    }

    offset += segmentLength
  }
  return null
}

function extractWebpDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30) return null
  const chunk = buf.toString('ascii', 12, 16)
  if (chunk === 'VP8X') {
    const width = 1 + (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16))
    const height = 1 + (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16))
    return { width, height }
  }
  if (chunk === 'VP8 ') {
    if (buf.length < 30 || buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null
    const width = buf.readUInt16LE(26) & 0x3fff
    const height = buf.readUInt16LE(28) & 0x3fff
    return { width, height }
  }
  if (chunk === 'VP8L') {
    if (buf.length < 25 || buf[20] !== 0x2f) return null
    const bits = buf.readUInt32LE(21)
    const width = (bits & 0x3fff) + 1
    const height = ((bits >> 14) & 0x3fff) + 1
    return { width, height }
  }
  return null
}

export function validateImageBuffer(buf: Buffer, declaredMime?: string): ValidatedImageResult {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request: Empty image payload.' })
  }

  if (buf.length > MAX_IMAGE_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: `Payload Too Large: Image exceeds ${MAX_IMAGE_BYTES / (1024 * 1024)}MB limit.`,
    })
  }

  const detectedMime = detectMimeByMagicBytes(buf)
  if (!detectedMime) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Unsupported image format. Allowed: JPEG, PNG, WEBP.',
    })
  }

  if (declaredMime && declaredMime.trim().length > 0) {
    const normalizedDeclared = declaredMime.toLowerCase().trim() === 'image/jpg'
      ? 'image/jpeg'
      : declaredMime.toLowerCase().trim()
    if (normalizedDeclared !== detectedMime) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request: Declared MIME type does not match image magic bytes.',
      })
    }
  }

  const dims =
    detectedMime === 'image/png'
      ? extractPngDimensions(buf)
      : detectedMime === 'image/jpeg'
        ? extractJpegDimensions(buf)
        : extractWebpDimensions(buf)

  if (!dims || dims.width <= 0 || dims.height <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Unable to parse valid image dimensions from header.',
    })
  }

  if (dims.width > MAX_IMAGE_DIMENSION || dims.height > MAX_IMAGE_DIMENSION) {
    throw createError({
      statusCode: 400,
      statusMessage: `Bad Request: Image dimensions exceed ${MAX_IMAGE_DIMENSION}x${MAX_IMAGE_DIMENSION}.`,
    })
  }

  if (dims.width * dims.height > MAX_IMAGE_PIXELS) {
    throw createError({
      statusCode: 400,
      statusMessage: `Bad Request: Image pixel count exceeds ${MAX_IMAGE_PIXELS} pixels.`,
    })
  }

  const extension = detectedMime === 'image/jpeg' ? 'jpg' : detectedMime === 'image/png' ? 'png' : 'webp'

  return {
    mimeType: detectedMime,
    extension,
    width: dims.width,
    height: dims.height,
    byteLength: buf.length,
  }
}

/**
 * Strictly validates that an image path belongs to `users/{uid}/{ingestType}/{uuid}.{ext}`
 * and prevents path traversal or cross-user references.
 */
export function assertOwnedImagePath(uid: string, imagePath: string): {
  ingestType: VisionIngestType
  fileName: string
} {
  if (!uid || !imagePath || imagePath.includes('..') || imagePath.includes('\\') || imagePath.startsWith('/')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden: Invalid image path.',
    })
  }

  const expectedPrefix = `users/${uid}/`
  if (!imagePath.startsWith(expectedPrefix)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden: Image path does not belong to authenticated user.',
    })
  }

  const remainder = imagePath.slice(expectedPrefix.length)
  const segments = remainder.split('/')
  if (segments.length !== 2) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden: Invalid image path hierarchy.',
    })
  }

  const [rawIngestType, fileName] = segments as [string, string]
  const parsedType = VisionIngestTypeSchema.safeParse(rawIngestType)
  if (!parsedType.success) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden: Invalid image ingest category.',
    })
  }

  if (!UUID_FILE_REGEX.test(fileName)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden: Invalid image file identifier.',
    })
  }

  return {
    ingestType: parsedType.data,
    fileName,
  }
}

/**
 * Strictly validates that an A2A staging image path belongs to `staging/{uid}/{taskId}.{ext}`.
 */
export function assertOwnedStagingPath(uid: string, stagingPath: string): {
  fileName: string
} {
  if (!uid || !stagingPath || stagingPath.includes('..') || stagingPath.includes('\\') || stagingPath.startsWith('/')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden: Invalid staging image path.',
    })
  }

  const expectedPrefix = `staging/${uid}/`
  if (!stagingPath.startsWith(expectedPrefix)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden: Staging path does not belong to authenticated user.',
    })
  }

  const fileName = stagingPath.slice(expectedPrefix.length)
  if (fileName.includes('/') || !UUID_FILE_REGEX.test(fileName)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden: Invalid staging file identifier.',
    })
  }

  return { fileName }
}
