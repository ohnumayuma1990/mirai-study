import { createHash, randomBytes } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { createError } from 'h3'
import { SSO_AUDIENCE, SSO_STATE_REGEX } from '../../shared/schemas/sso'
import { getAdminFirestore } from './firebase-admin'
import { resolveMappedFirebaseUid } from './hub-account-mapping'
import {
  timingSafeStringEqual,
  verifyHmacToken,
  type SignedTokenPayload,
} from './signed-token'

export const SSO_CONSUMED_JTI_COLLECTION = 'sso_consumed_jtis' as const
const JTI_TTL_BUFFER_SECONDS = 86_400 // 24 hours buffer after JWT exp for Firestore TTL

export interface SsoJtiStore {
  consumeOnce(jti: string, expEpochSeconds: number, nowEpochSeconds: number): Promise<void>
}

function isFirestoreAlreadyExistsError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const record = err as { code?: unknown; message?: unknown }
  if (record.code === 6 || record.code === 'already-exists' || record.code === 'ALREADY_EXISTS') {
    return true
  }
  if (typeof record.message === 'string' && record.message.includes('ALREADY_EXISTS')) {
    return true
  }
  return false
}

export function hashSsoJti(jti: string): string {
  return createHash('sha256').update(jti, 'utf8').digest('hex')
}

export const firestoreSsoJtiStore: SsoJtiStore = {
  async consumeOnce(jti: string, expEpochSeconds: number, nowEpochSeconds: number): Promise<void> {
    const jtiHash = hashSsoJti(jti)
    const docRef = getAdminFirestore().collection(SSO_CONSUMED_JTI_COLLECTION).doc(jtiHash)
    try {
      await docRef.create({
        jtiHash,
        exp: expEpochSeconds,
        consumedAt: nowEpochSeconds,
        expiresAt: Timestamp.fromMillis((expEpochSeconds + JTI_TTL_BUFFER_SECONDS) * 1000),
      })
    } catch (err) {
      if (isFirestoreAlreadyExistsError(err)) {
        throw createError({
          statusCode: 401,
          statusMessage: 'Unauthorized: SSO code has already been consumed.',
        })
      }
      throw createError({
        statusCode: 503,
        statusMessage: 'Service Unavailable: Failed to verify SSO code uniqueness.',
      })
    }
  },
}

export function generateSsoState(): string {
  return randomBytes(32).toString('hex')
}

export function validateStrictOrigin(
  rawOrigin: string,
  label: string,
  options: { allowLocalHttp?: boolean } = {},
): string {
  const trimmed = rawOrigin.trim()
  if (!trimmed) {
    throw createError({
      statusCode: 503,
      statusMessage: `Service Unavailable: ${label} is not configured.`,
    })
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw createError({
      statusCode: 503,
      statusMessage: `Service Unavailable: ${label} is not a valid URL origin.`,
    })
  }

  if (
    url.origin !== trimmed ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw createError({
      statusCode: 503,
      statusMessage: `Service Unavailable: ${label} must be a bare origin without path, query, or credentials.`,
    })
  }

  const isLocalHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  const allowLocalHttp = options.allowLocalHttp ?? process.env.NODE_ENV !== 'production'
  if (url.protocol !== 'https:' && !(allowLocalHttp && isLocalHost && url.protocol === 'http:')) {
    throw createError({
      statusCode: 503,
      statusMessage: `Service Unavailable: ${label} must use HTTPS.`,
    })
  }

  return url.origin
}

export function extractConfiguredA2aSecrets(
  a2aSharedSecret: string,
  a2aCallersJson: string,
): string[] {
  const secrets: string[] = []
  const trimmedSingle = a2aSharedSecret.trim()
  if (trimmedSingle.length > 0) {
    secrets.push(trimmedSingle)
  }

  const trimmedJson = a2aCallersJson.trim()
  if (trimmedJson.length > 0) {
    try {
      const parsed: unknown = JSON.parse(trimmedJson)
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).secret === 'string') {
            const secret = ((item as Record<string, unknown>).secret as string).trim()
            if (secret.length > 0) {
              secrets.push(secret)
            }
          }
        }
      }
    } catch {
      // Malformed a2aCallersJson is handled by parseA2aCallers when A2A is invoked
    }
  }

  return secrets
}

export function assertSsoAndA2aSecretsDistinct(
  ssoSharedSecret: string,
  a2aSharedSecret: string,
  a2aCallersJson: string,
): void {
  const trimmedSso = ssoSharedSecret.trim()
  if (!trimmedSso) return

  const a2aSecrets = extractConfiguredA2aSecrets(a2aSharedSecret, a2aCallersJson)
  for (const a2aSecret of a2aSecrets) {
    if (timingSafeStringEqual(trimmedSso, a2aSecret)) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Service Unavailable: SSO and A2A signing secrets must be distinct.',
      })
    }
  }
}

export interface VerifySsoCodeOptions {
  code: string
  state: string
  cookieState: string | undefined
  ssoEnabled: boolean
  ssoSharedSecret: string
  ssoAllowedIssuer: string
  hubAccountMappingsJson: string
  a2aSharedSecret?: string
  a2aCallersJson?: string
  nowEpochSeconds?: number
  jtiStore?: SsoJtiStore
}

export async function verifyAndConsumeSsoCode(options: VerifySsoCodeOptions): Promise<{
  uid: string
  email: string
  ssoAt: number
  payload: SignedTokenPayload
}> {
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

  const allowedIssuer = options.ssoAllowedIssuer.trim()
  if (!allowedIssuer) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable: SSO allowed issuer is not configured.',
    })
  }

  assertSsoAndA2aSecretsDistinct(
    options.ssoSharedSecret,
    options.a2aSharedSecret ?? '',
    options.a2aCallersJson ?? '',
  )

  if (!SSO_STATE_REGEX.test(options.state)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Invalid SSO state format.',
    })
  }

  if (!options.cookieState || !SSO_STATE_REGEX.test(options.cookieState)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized: Missing or invalid SSO state cookie.',
    })
  }

  if (!timingSafeStringEqual(options.state, options.cookieState)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized: SSO state mismatch.',
    })
  }

  const now = options.nowEpochSeconds ?? Math.floor(Date.now() / 1000)

  let payload: SignedTokenPayload
  try {
    payload = verifyHmacToken(options.code, {
      secret: options.ssoSharedSecret,
      expectedAudience: SSO_AUDIENCE,
      expectedIssuer: allowedIssuer,
      requireSub: false,
      nowEpochSeconds: now,
    })
  } catch (err) {
    throw createError({
      statusCode: 401,
      statusMessage: `Unauthorized: Invalid SSO code (${err instanceof Error ? err.message : 'verification failed'}).`,
    })
  }

  if (typeof payload.state !== 'string' || !timingSafeStringEqual(payload.state, options.state)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized: SSO code state claim mismatch.',
    })
  }

  if (typeof payload.jti !== 'string' || payload.jti.trim().length === 0 || payload.jti.length > 256) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized: SSO code jti claim is required.',
    })
  }

  // Resolve Hub account mapping BEFORE touching Firestore to prevent unmapped write amplification
  const mapped = resolveMappedFirebaseUid(payload.email, options.hubAccountMappingsJson)

  // Atomic single-use jti consumption (Firestore create() in production; no in-memory fallback)
  const store = options.jtiStore ?? firestoreSsoJtiStore
  await store.consumeOnce(payload.jti.trim(), payload.exp, now)

  return {
    uid: mapped.uid,
    email: mapped.email,
    ssoAt: now,
    payload,
  }
}
