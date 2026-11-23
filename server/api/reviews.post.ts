import { createError, defineEventHandler, readBody } from 'h3'
import { ReviewItemBatchInputSchema, ReviewItemInputSchema } from '../../shared/schemas/review-item'
import { requireAuthUser } from '../utils/auth'
import { createReviewItems } from '../domain/miraistudy-service'

export default defineEventHandler(async (event) => {
  const user = await requireAuthUser(event)
  const body = await readBody(event)

  // Support both single ReviewItemInput and batch { items: ReviewItemInput[] }
  const batchParsed = ReviewItemBatchInputSchema.safeParse(body)
  if (batchParsed.success) {
    const items = await createReviewItems(user.uid, batchParsed.data.items)
    return { items }
  }

  const singleParsed = ReviewItemInputSchema.safeParse(body)
  if (singleParsed.success) {
    const items = await createReviewItems(user.uid, [singleParsed.data])
    return { item: items[0], items }
  }

  throw createError({
    statusCode: 400,
    statusMessage: 'Bad Request: Invalid review item payload.',
  })
})
