export interface ResizedImageOutput {
  blob: Blob
  fileName: string
  mimeType: 'image/jpeg'
  width: number
  height: number
  previewUrl: string
}

const MAX_LONG_EDGE = 1280
const JPEG_QUALITY = 0.85

/**
 * Forces browser Canvas re-encoding (max long edge 1280px, JPEG) to strip all EXIF metadata (GPS, camera PII)
 * regardless of original file dimensions.
 */
export function useImageResize() {
  async function resizeAndStripExif(file: File): Promise<ResizedImageOutput> {
    if (!import.meta.client) {
      throw new Error('画像リサイズはブラウザ環境でのみ実行できます。')
    }

    const bitmapUrl = URL.createObjectURL(file)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image()
        element.onload = () => resolve(element)
        element.onerror = () => reject(new Error('画像の読み込みに失敗しました。'))
        element.src = bitmapUrl
      })

      const origWidth = img.naturalWidth
      const origHeight = img.naturalHeight
      if (origWidth <= 0 || origHeight <= 0) {
        throw new Error('有効な画像サイズを取得できませんでした。')
      }

      const scale = Math.min(1, MAX_LONG_EDGE / Math.max(origWidth, origHeight))
      const targetWidth = Math.max(1, Math.round(origWidth * scale))
      const targetHeight = Math.max(1, Math.round(origHeight * scale))

      const canvas = document.createElement('canvas')
      canvas.width = targetWidth
      canvas.height = targetHeight

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        throw new Error('Canvas コンテキストの初期化に失敗しました。')
      }

      ctx.drawImage(img, 0, 0, targetWidth, targetHeight)

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => {
            if (!result) {
              reject(new Error('画像の再エンコードに失敗しました。'))
              return
            }
            resolve(result)
          },
          'image/jpeg',
          JPEG_QUALITY,
        )
      })

      const previewUrl = URL.createObjectURL(blob)
      const baseName = file.name.replace(/\.[^.]+$/, '') || 'study-image'

      return {
        blob,
        fileName: `${baseName}.jpg`,
        mimeType: 'image/jpeg',
        width: targetWidth,
        height: targetHeight,
        previewUrl,
      }
    } finally {
      URL.revokeObjectURL(bitmapUrl)
    }
  }

  return { resizeAndStripExif }
}
