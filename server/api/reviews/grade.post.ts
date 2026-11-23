import { createError, defineEventHandler, readBody } from 'h3'
import { ReviewGradeInputSchema } from '../../../shared/schemas/review-item'
import { requireAuthUser } from '../../utils/auth'
import { gradeReviewItem } from '../../domain/miraistudy-service'

export default defineEventHandler(async (event) => {
  const user = await requireAuthUser(event)
  const body = await readBody(event)
  const parsed = ReviewGradeInputSchema.safeParse(body)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Invalid review grade payload.',
    })
  }

  const item = await gradeReviewItem(user.uid, parsed.data.id, parsed.data.grade)
  return { item }
})
