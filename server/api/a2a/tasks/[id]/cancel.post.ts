import { createError, defineEventHandler, getRouterParam, setResponseHeader } from 'h3'
import { requireA2aCaller } from '../../../../utils/a2a-auth'
import { a2aRateLimiter } from '../../../../utils/rate-limit'
import { getClientIp } from '../../../../utils/request-ip'
import { cancelA2aDraftTask } from '../../../../domain/record-task'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')

  const ip = getClientIp(event)
  a2aRateLimiter.assertAllowed(`a2a:ip:${ip}`)

  const caller = await requireA2aCaller(event, {
    requiredScope: 'write',
    requireUser: true,
  })
  const uid = caller.uid!
  a2aRateLimiter.assertAllowed(`a2a:uid:${uid}`)

  const taskId = getRouterParam(event, 'id')?.trim()
  if (!taskId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request: Missing task id.' })
  }

  const task = await cancelA2aDraftTask(uid, taskId)
  return { task }
})
