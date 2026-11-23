import { createError, defineEventHandler, readBody } from 'h3'
import { DevLogInputSchema } from '../../shared/schemas/dev-log'
import { requireAuthUser } from '../utils/auth'
import { createDevLog } from '../domain/miraistudy-service'

export default defineEventHandler(async (event) => {
  const user = await requireAuthUser(event)
  const body = await readBody(event)
  const parsed = DevLogInputSchema.safeParse(body)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Invalid dev log payload.',
    })
  }

  const log = await createDevLog(user.uid, parsed.data)
  return { log }
})
