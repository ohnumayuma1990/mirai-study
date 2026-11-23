import { createError, defineEventHandler, readBody } from 'h3'
import { ExamLogInputSchema } from '../../shared/schemas/exam-log'
import { requireAuthUser } from '../utils/auth'
import { createExamLog } from '../domain/miraistudy-service'

export default defineEventHandler(async (event) => {
  const user = await requireAuthUser(event)
  const body = await readBody(event)
  const parsed = ExamLogInputSchema.safeParse(body)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Invalid exam log payload.',
    })
  }

  const log = await createExamLog(user.uid, parsed.data)
  return { log }
})
