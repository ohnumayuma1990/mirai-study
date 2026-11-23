import { createError, defineEventHandler, readBody } from 'h3'
import { StudyTrackInputSchema } from '../../shared/schemas/track'
import { requireAuthUser } from '../utils/auth'
import { upsertStudyTrack } from '../domain/miraistudy-service'

export default defineEventHandler(async (event) => {
  const user = await requireAuthUser(event)
  const body = await readBody(event)
  const parsed = StudyTrackInputSchema.safeParse(body)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Invalid study track payload.',
    })
  }

  const track = await upsertStudyTrack(user.uid, parsed.data)
  return { track }
})
