import { describe, expect, it } from 'vitest'
import { MAX_IMAGE_BYTES, validateImageBuffer } from '../server/utils/image-validation'

function buildMinimalPng(width: number, height: number): Buffer {
  const buf = Buffer.alloc(32)
  // PNG signature
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0)
  // IHDR length = 13
  buf.writeUInt32BE(13, 8)
  buf.write('IHDR', 12, 'ascii')
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  return buf
}

describe('server/utils/image-validation', () => {
  it('accepts valid PNG within 4MB and 4096x4096 / 16MP limits', () => {
    const png = buildMinimalPng(1280, 720)
    const res = validateImageBuffer(png, 'image/png')
    expect(res.mimeType).toBe('image/png')
    expect(res.extension).toBe('png')
    expect(res.width).toBe(1280)
    expect(res.height).toBe(720)
  })

  it('rejects oversized payload (>4MB) with 413', () => {
    const oversized = Buffer.alloc(MAX_IMAGE_BYTES + 1)
    expect(() => validateImageBuffer(oversized, 'image/png')).toThrowError()
  })

  it('rejects MIME spoofing when magic bytes do not match declared MIME', () => {
    const png = buildMinimalPng(640, 480)
    expect(() => validateImageBuffer(png, 'image/jpeg')).toThrowError()
  })

  it('rejects images exceeding 4096 dimension or 16MP limit', () => {
    const tooWide = buildMinimalPng(5000, 1000)
    expect(() => validateImageBuffer(tooWide, 'image/png')).toThrowError()

    const tooManyPixels = buildMinimalPng(4096, 4096) // 16.77MP > 16MP
    expect(() => validateImageBuffer(tooManyPixels, 'image/png')).toThrowError()
  })
})
