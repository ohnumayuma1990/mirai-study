import { randomUUID } from 'node:crypto'
import { createError, defineEventHandler, readMultipartFormData } from 'h3'
import { TRACK_ID_REGEX } from '../../../shared/schemas/track'
import { VisionIngestTypeSchema, type VisionIngestResponse } from '../../../shared/schemas/vision'
import { requireAuthUser } from '../../utils/auth'
import { getAdminStorageBucket } from '../../utils/firebase-admin'
import { validateImageBuffer } from '../../utils/image-validation'
import { analyzeStudyImageWithOpenAI } from '../../utils/openai'
import { visionRateLimiter } from '../../utils/rate-limit'
import { getClientIp } from '../../utils/request-ip'

export default defineEventHandler(async (event): Promise<VisionIngestResponse> => {
  const user = await requireAuthUser(event)
  const ip = getClientIp(event)
  visionRateLimiter.assertAllowed(`vision:uid:${user.uid}`)
  visionRateLimiter.assertAllowed(`vision:ip:${ip}`)

  const parts = await readMultipartFormData(event)
  if (!parts || parts.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Expected multipart/form-data payload.',
    })
  }

  const filePart = parts.find((p) => p.name === 'image' && p.data)
  const ingestTypePart = parts.find((p) => p.name === 'ingestType')
  const trackIdPart = parts.find((p) => p.name === 'trackId')
  const userNotePart = parts.find((p) => p.name === 'userNote')

  if (!filePart || !filePart.data) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Image file field "image" is required.',
    })
  }

  const rawIngestType = ingestTypePart?.data?.toString('utf8').trim() ?? ''
  const parsedIngestType = VisionIngestTypeSchema.safeParse(rawIngestType)
  if (!parsedIngestType.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Invalid ingestType.',
    })
  }

  const rawTrackId = trackIdPart?.data?.toString('utf8').trim() || null
  if (rawTrackId !== null && !TRACK_ID_REGEX.test(rawTrackId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Invalid trackId format.',
    })
  }

  const userNote = userNotePart?.data?.toString('utf8').trim() || undefined
  const validatedImage = validateImageBuffer(filePart.data, filePart.type)

  const config = useRuntimeConfig()
  const openaiApiKey = String(config.openaiApiKey ?? '')
  const openaiModel = String(config.openaiModel ?? 'gpt-4.1-mini')

  // Fail-closed: check storage config before spending OpenAI tokens,
  // but write to GCS only AFTER OpenAI succeeds to prevent orphan objects.
  const bucket = getAdminStorageBucket()

  const analysis = await analyzeStudyImageWithOpenAI({
    apiKey: openaiApiKey,
    model: openaiModel,
    ingestType: parsedIngestType.data,
    imageBuffer: filePart.data,
    mimeType: validatedImage.mimeType,
    userNote,
  })

  const imagePath = `users/${user.uid}/${parsedIngestType.data}/${randomUUID()}.${validatedImage.extension}`
  await bucket.file(imagePath).save(filePart.data, {
    contentType: validatedImage.mimeType,
    resumable: false,
    metadata: {
      cacheControl: 'private, max-age=31536000',
    },
  })

  return {
    imagePath,
    trackId: rawTrackId,
    analysis,
  }
})
