import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireA2aCaller } from '../../../../utils/a2a-auth'
import { cancelA2aDraftTask } from '../../../../domain/record-task'

export default defineEventHandler(async (event) => {
  const caller = requireA2aCaller(event)
  const taskId = getRouterParam(event, 'id')?.trim()
  if (!taskId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request: Missing task id.' })
  }

  const task = await cancelA2aDraftTask(caller.uid, taskId)
  return { task }
})
