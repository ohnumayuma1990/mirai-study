import { createError, defineEventHandler, getQuery } from 'h3'
import { DevLogsQuerySchema, type DevLogsListResponse } from '../../shared/schemas/dev-log'
import { requireAuthUser } from '../utils/auth'
import { listDevLogs } from '../domain/miraistudy-service'

export default defineEventHandler(async (event): Promise<DevLogsListResponse> => {
  const user = await requireAuthUser(event)
  const parsed = DevLogsQuerySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Invalid dev logs query.',
    })
  }

  const logs = await listDevLogs(user.uid, parsed.data)
  return { logs }
})
