import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { A2aTaskCommitBodySchema } from '../../../../../shared/schemas/a2a'
import { requireA2aCaller } from '../../../../utils/a2a-auth'
import { commitA2aDraftTask } from '../../../../domain/record-task'

export default defineEventHandler(async (event) => {
  const caller = requireA2aCaller(event)
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
    uid: caller.uid,
    taskId,
    recordKind: parsed.data.recordKind,
    payload: parsed.data.payload,
  })
})
