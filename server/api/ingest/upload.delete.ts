import { createError, defineEventHandler, readBody } from 'h3'
import { DeleteUploadBodySchema } from '../../../shared/schemas/vision'
import { requireAuthUser } from '../../utils/auth'
import { getAdminStorageBucket } from '../../utils/firebase-admin'
import { assertOwnedImagePath } from '../../utils/image-validation'

export default defineEventHandler(async (event) => {
  const user = await requireAuthUser(event)
  const body = await readBody(event)
  const parsed = DeleteUploadBodySchema.safeParse(body)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Invalid imagePath payload.',
    })
  }

  assertOwnedImagePath(user.uid, parsed.data.imagePath)

  const bucket = getAdminStorageBucket()
  await bucket.file(parsed.data.imagePath).delete({ ignoreNotFound: true })

  return { deleted: true, imagePath: parsed.data.imagePath }
})
