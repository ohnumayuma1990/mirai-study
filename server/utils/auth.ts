import { createError, getHeader, type H3Event } from 'h3'
import { SSO_FRESHNESS_MAX_SECONDS } from '../../shared/schemas/sso'
import { getAdminAuth } from './firebase-admin'
import { parseBooleanRuntimeFlag } from './runtime-config'

export interface AuthenticatedUser {
  uid: string
  email?: string
  ssoAt?: number
}

export interface DecodedTokenLike {
  uid: string
  email?: string
  sso_at?: unknown
}

export function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) {
    return null
  }
  const trimmed = authorizationHeader.trim()
  if (!trimmed.toLowerCase().startsWith('bearer ')) {
    return null
  }
  const token = trimmed.slice(7).trim()
  return token.length > 0 ? token : null
}

export function validateSsoFreshness(
  decoded: DecodedTokenLike,
  ssoEnabled: boolean,
  nowEpochSeconds: number = Math.floor(Date.now() / 1000),
): number | undefined {
  if (!ssoEnabled) {
    return typeof decoded.sso_at === 'number' ? decoded.sso_at : undefined
  }

  if (typeof decoded.sso_at !== 'number' || !Number.isFinite(decoded.sso_at)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized: SSO session claim is missing.',
    })
  }

  const ageSeconds = nowEpochSeconds - decoded.sso_at
  if (ageSeconds < -60 || ageSeconds > SSO_FRESHNESS_MAX_SECONDS) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized: SSO session has expired. Please re-authenticate.',
    })
  }

  return decoded.sso_at
}

export async function verifyBearerTokenWithVerifier(params: {
  authorizationHeader: string | undefined
  ssoEnabled: boolean
  verifyIdToken: (token: string, checkRevoked: boolean) => Promise<DecodedTokenLike>
  nowEpochSeconds?: number
}): Promise<AuthenticatedUser> {
  const token = extractBearerToken(params.authorizationHeader)
  if (!token) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized: Missing Bearer token.',
    })
  }

  let decoded: DecodedTokenLike
  try {
    decoded = await params.verifyIdToken(token, true)
  } catch {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized: Invalid or revoked ID token.',
    })
  }

  if (!decoded.uid || typeof decoded.uid !== 'string') {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized: Token missing subject.',
    })
  }

  const ssoAt = validateSsoFreshness(decoded, params.ssoEnabled, params.nowEpochSeconds)

  return {
    uid: decoded.uid,
    email: decoded.email,
    ssoAt,
  }
}

export async function requireAuthUser(event: H3Event): Promise<AuthenticatedUser> {
  const config = useRuntimeConfig()
  const ssoEnabled = parseBooleanRuntimeFlag(config.ssoEnabled, false)
  const authHeader = getHeader(event, 'authorization')
  const auth = getAdminAuth()

  return verifyBearerTokenWithVerifier({
    authorizationHeader: authHeader,
    ssoEnabled,
    verifyIdToken: (token, checkRevoked) => auth.verifyIdToken(token, checkRevoked),
  })
}
