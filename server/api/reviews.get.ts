import { createError, defineEventHandler, getQuery } from 'h3'
import { ReviewsQuerySchema, type ReviewsListResponse } from '../../shared/schemas/review-item'
import { requireAuthUser } from '../utils/auth'
import { listReviewItems } from '../domain/miraistudy-service'

export default defineEventHandler(async (event): Promise<ReviewsListResponse> => {
  const user = await requireAuthUser(event)
  const parsed = ReviewsQuerySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Invalid reviews query.',
    })
  }

  return listReviewItems(user.uid, parsed.data)
})
