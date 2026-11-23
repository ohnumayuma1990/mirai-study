import { createError, defineEventHandler, getQuery } from 'h3'
import { StudySessionsQuerySchema, type StudySessionsListResponse } from '../../shared/schemas/study-session'
import { requireAuthUser } from '../utils/auth'
import { listStudySessions } from '../domain/miraistudy-service'

export default defineEventHandler(async (event): Promise<StudySessionsListResponse> => {
  const user = await requireAuthUser(event)
  const parsed = StudySessionsQuerySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Invalid study sessions query.',
    })
  }

  const sessions = await listStudySessions(user.uid, parsed.data)
  return { sessions }
})
