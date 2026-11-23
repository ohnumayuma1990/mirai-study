import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { ReviewGradeBodySchema } from '../../../../shared/schemas/review-item'
import { requireAuthUser } from '../../../utils/auth'
import { gradeReviewItem } from '../../../domain/miraistudy-service'

export default defineEventHandler(async (event) => {
  const user = await requireAuthUser(event)
  const id = getRouterParam(event, 'id')?.trim()
  if (!id || id.length > 128) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Missing review item id.',
    })
  }

  const body = await readBody(event)
  const parsed = ReviewGradeBodySchema.safeParse(body)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Invalid review grade.',
    })
  }

  const item = await gradeReviewItem(user.uid, id, parsed.data.grade)
  return { item }
})
