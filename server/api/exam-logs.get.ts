import { createError, defineEventHandler, getQuery } from 'h3'
import { ExamLogsQuerySchema, type ExamLogsListResponse } from '../../shared/schemas/exam-log'
import { requireAuthUser } from '../utils/auth'
import { listExamLogs } from '../domain/miraistudy-service'

export default defineEventHandler(async (event): Promise<ExamLogsListResponse> => {
  const user = await requireAuthUser(event)
  const parsed = ExamLogsQuerySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Invalid exam logs query.',
    })
  }

  const logs = await listExamLogs(user.uid, parsed.data)
  return { logs }
})
