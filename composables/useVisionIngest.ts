import type { VisionIngestResponse, VisionIngestType } from '../shared/schemas/vision'
import type { ResizedImageOutput } from './useImageResize'

export function useVisionIngest() {
  const { apiFetch } = useApiFetch()
  const { resizeAndStripExif } = useImageResize()

  const resizedImage = ref<ResizedImageOutput | null>(null)
  const ingestResult = ref<VisionIngestResponse | null>(null)
  const analyzing = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  function clearPreview(): void {
    if (resizedImage.value?.previewUrl) {
      URL.revokeObjectURL(resizedImage.value.previewUrl)
    }
    resizedImage.value = null
  }

  async function prepareImage(file: File): Promise<void> {
    error.value = null
    clearPreview()
    resizedImage.value = await resizeAndStripExif(file)
  }

  async function runAnalysis(params: {
    ingestType: VisionIngestType
    trackId: string | null
    userNote?: string
  }): Promise<void> {
    if (!resizedImage.value) {
      error.value = '解析する画像を選択してください。'
      return
    }

    analyzing.value = true
    error.value = null
    try {
      const formData = new FormData()
      formData.append('image', resizedImage.value.blob, resizedImage.value.fileName)
      formData.append('ingestType', params.ingestType)
      if (params.trackId) {
        formData.append('trackId', params.trackId)
      }
      if (params.userNote?.trim()) {
        formData.append('userNote', params.userNote.trim())
      }

      ingestResult.value = await apiFetch<VisionIngestResponse>('/api/ingest/vision', {
        method: 'POST',
        body: formData,
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Vision 画像解析に失敗しました。'
    } finally {
      analyzing.value = false
    }
  }

  async function discardUploadedImage(): Promise<void> {
    if (!ingestResult.value?.imagePath) return
    try {
      await apiFetch('/api/ingest/upload', {
        method: 'DELETE',
        body: { imagePath: ingestResult.value.imagePath },
      })
    } finally {
      ingestResult.value = null
    }
  }

  onBeforeUnmount(() => {
    clearPreview()
  })

  return {
    resizedImage,
    ingestResult,
    analyzing,
    saving,
    error,
    prepareImage,
    runAnalysis,
    discardUploadedImage,
    clearPreview,
  }
}
