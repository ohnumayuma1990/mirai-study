import { createError } from 'h3'
import { SSO_AUDIENCE } from '../../shared/schemas/sso'
import { verifyHmacToken, type SignedTokenPayload } from './signed-token'

const consumedJtis = new Map<string, number>()
const MAX_CONSUMED_JTIS = 5000

function pruneConsumedJtis(nowEpochSeconds: number): void {
  for (const [jti, exp] of consumedJtis.entries()) {
    if (exp < nowEpochSeconds) {
      consumedJtis.delete(jti)
    }
  }
  while (consumedJtis.size > MAX_CONSUMED_JTIS) {
    const oldest = consumedJtis.keys().next().value
    if (oldest === undefined) break
    consumedJtis.delete(oldest)
  }
}

export interface VerifySsoTokenOptions {
  token: string
  ssoEnabled: boolean
  ssoSharedSecret: string
  ssoProviderOrigin: string
  nowEpochSeconds?: number
}

export function verifyAndConsumeSsoToken(options: VerifySsoTokenOptions): {
  uid: string
  ssoAt: number
  payload: SignedTokenPayload
} {
  if (!options.ssoEnabled) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden: SSO is disabled.',
    })
  }

  if (!options.ssoSharedSecret || options.ssoSharedSecret.length < 32) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable: SSO shared secret is not configured.',
    })
  }

  if (!options.ssoProviderOrigin) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable: SSO provider origin is not configured.',
    })
  }

  const now = options.nowEpochSeconds ?? Math.floor(Date.now() / 1000)
  pruneConsumedJtis(now)

  let payload: SignedTokenPayload
  try {
    payload = verifyHmacToken(options.token, {
      secret: options.ssoSharedSecret,
      expectedAudience: SSO_AUDIENCE,
      expectedIssuer: options.ssoProviderOrigin,
      nowEpochSeconds: now,
    })
  } catch (err) {
    throw createError({
      statusCode: 401,
      statusMessage: `Unauthorized: Invalid SSO token (${err instanceof Error ? err.message : 'verification failed'}).`,
    })
  }

  if (payload.jti) {
    if (consumedJtis.has(payload.jti)) {
      throw createError({
        statusCode: 401,
        statusMessage: 'Unauthorized: SSO token has already been consumed.',
      })
    }
    consumedJtis.set(payload.jti, payload.exp)
  }

  return {
    uid: payload.sub,
    ssoAt: now,
    payload,
  }
}

export function resetConsumedSsoTokensForTest(): void {
  consumedJtis.clear()
}
