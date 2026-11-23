import { createError, defineEventHandler, getRouterParam, readBody, setResponseHeader } from 'h3'
import { A2aTaskCommitBodySchema } from '../../../../../shared/schemas/a2a'
import { requireA2aCaller } from '../../../../utils/a2a-auth'
import { a2aRateLimiter } from '../../../../utils/rate-limit'
import { getClientIp } from '../../../../utils/request-ip'
import { commitA2aDraftTask } from '../../../../domain/record-task'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')

  const ip = getClientIp(event)
  a2aRateLimiter.assertAllowed(`a2a:ip:${ip}`)

  const caller = requireA2aCaller(event, {
    requiredScope: 'write',
    requireUser: true,
  })
  const uid = caller.uid!
  a2aRateLimiter.assertAllowed(`a2a:uid:${uid}`)

  const taskId = getRouterParam(event, 'id')?.trim()
  if (!taskId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request: Missing task id.' })
  }

  const body = await readBody(event)
  const parsed = A2aTaskCommitBodySchema.safeParse(body)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request: Invalid task commit payload.' })
  }

  return commitA2aDraftTask({
    uid,
    taskId,
    recordKind: parsed.data.recordKind,
    payload: parsed.data.payload,
  })
})
