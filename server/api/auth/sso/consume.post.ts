import { createError, defineEventHandler, readBody } from 'h3'
import { SsoConsumeRequestSchema, type SsoConsumeResponse } from '../../../../shared/schemas/sso'
import { getAdminAuth } from '../../../utils/firebase-admin'
import { ssoRateLimiter } from '../../../utils/rate-limit'
import { getClientIp } from '../../../utils/request-ip'
import { verifyAndConsumeSsoToken } from '../../../utils/sso'

export default defineEventHandler(async (event): Promise<SsoConsumeResponse> => {
  const ip = getClientIp(event)
  ssoRateLimiter.assertAllowed(`sso:ip:${ip}`)

  const body = await readBody(event)
  const parsed = SsoConsumeRequestSchema.safeParse(body)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Invalid SSO token payload.',
    })
  }

  const config = useRuntimeConfig()
  const verified = verifyAndConsumeSsoToken({
    token: parsed.data.token,
    ssoEnabled: Boolean(config.ssoEnabled),
    ssoSharedSecret: String(config.ssoSharedSecret ?? ''),
    ssoProviderOrigin: String(config.ssoProviderOrigin ?? ''),
  })

  const auth = getAdminAuth()
  const customToken = await auth.createCustomToken(verified.uid, {
    sso_at: verified.ssoAt,
  })

  return {
    customToken,
    uid: verified.uid,
    ssoAt: verified.ssoAt,
  }
})
