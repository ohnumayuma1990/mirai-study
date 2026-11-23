import {
  createError,
  defineEventHandler,
  deleteCookie,
  getCookie,
  readBody,
  setResponseHeader,
} from 'h3'
import {
  SSO_STATE_COOKIE_NAME,
  SsoConsumeRequestSchema,
  type SsoConsumeResponse,
} from '../../../../shared/schemas/sso'
import { getAdminAuth } from '../../../utils/firebase-admin'
import { ssoRateLimiter } from '../../../utils/rate-limit'
import { getClientIp } from '../../../utils/request-ip'
import { verifyAndConsumeSsoCode } from '../../../utils/sso'

function isFirebaseAuthUserNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  return code === 'auth/user-not-found'
}

export default defineEventHandler(async (event): Promise<SsoConsumeResponse> => {
  const ip = getClientIp(event)
  ssoRateLimiter.assertAllowed(`sso:ip:${ip}`)

  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer')

  const body = await readBody(event)
  const parsed = SsoConsumeRequestSchema.safeParse(body)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Invalid SSO code or state payload.',
    })
  }

  const cookieState = getCookie(event, SSO_STATE_COOKIE_NAME)
  // Always clear state cookie immediately after reading to enforce single attempt
  deleteCookie(event, SSO_STATE_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth/sso',
  })

  const config = useRuntimeConfig()
  const verified = await verifyAndConsumeSsoCode({
    code: parsed.data.code,
    state: parsed.data.state,
    cookieState,
    ssoEnabled: Boolean(config.ssoEnabled),
    ssoSharedSecret: String(config.ssoSharedSecret ?? ''),
    ssoAllowedIssuer: String(config.ssoAllowedIssuer ?? 'team-management'),
    hubAccountMappingsJson: String(config.hubAccountMappingsJson ?? ''),
    a2aSharedSecret: String(config.a2aSharedSecret ?? ''),
    a2aCallersJson: String(config.a2aCallersJson ?? ''),
  })

  const auth = getAdminAuth()

  let userRecord
  try {
    userRecord = await auth.getUser(verified.uid)
  } catch (err) {
    if (isFirebaseAuthUserNotFound(err)) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden: Mapped MiraiStudy account does not exist.',
      })
    }
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable: Failed to verify MiraiStudy account status.',
    })
  }

  if (userRecord.disabled) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden: Mapped MiraiStudy account is disabled.',
    })
  }

  let customToken: string
  try {
    customToken = await auth.createCustomToken(verified.uid, {
      sso_at: verified.ssoAt,
    })
  } catch {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable: Failed to mint Firebase custom token.',
    })
  }

  return {
    customToken,
    uid: verified.uid,
    ssoAt: verified.ssoAt,
  }
})
