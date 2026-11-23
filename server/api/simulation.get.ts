import { createError, defineEventHandler, getQuery } from 'h3'
import { SimulationQuerySchema } from '../../shared/schemas/simulation'
import { requireAuthUser } from '../utils/auth'
import { getStudySimulationForUser } from '../domain/miraistudy-service'

export default defineEventHandler(async (event) => {
  const user = await requireAuthUser(event)
  const parsed = SimulationQuerySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Invalid simulation query parameters.',
    })
  }

  return getStudySimulationForUser(user.uid, parsed.data)
})
