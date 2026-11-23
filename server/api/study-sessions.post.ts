import { createError, defineEventHandler, readBody } from 'h3'
import { StudySessionInputSchema } from '../../shared/schemas/study-session'
import { requireAuthUser } from '../utils/auth'
import { createStudySession } from '../domain/miraistudy-service'

export default defineEventHandler(async (event) => {
  const user = await requireAuthUser(event)
  const body = await readBody(event)
  const parsed = StudySessionInputSchema.safeParse(body)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Invalid study session payload.',
    })
  }

  const session = await createStudySession(user.uid, parsed.data)
  return { session }
})
