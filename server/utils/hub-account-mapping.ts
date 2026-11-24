import { createError } from 'h3'
import { parseRuntimeJsonConfig } from './runtime-config'
import { getAdminAuth } from './firebase-admin'

export interface HubAccountMapping {
  email: string
  uid: string
}

export interface FirebaseAuthUserLike {
  uid: string
  email?: string
  disabled?: boolean
  emailVerified?: boolean
}

export interface FirebaseAuthAdapter {
  getUser(uid: string): Promise<FirebaseAuthUserLike>
  getUserByEmail(email: string): Promise<FirebaseAuthUserLike>
  createUser(properties: { email: string; emailVerified: boolean }): Promise<FirebaseAuthUserLike>
  updateUser(uid: string, properties: { emailVerified: boolean }): Promise<FirebaseAuthUserLike>
}

const SIMPLE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeHubEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function validateAndNormalizeHubEmail(rawEmail: unknown): string {
  if (typeof rawEmail !== 'string') {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized: Verified Hub email claim is missing or invalid.',
    })
  }
  const normalized = normalizeHubEmail(rawEmail)
  if (!SIMPLE_EMAIL_REGEX.test(normalized)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized: Verified Hub email claim is missing or invalid.',
    })
  }
  return normalized
}

export function parseHubAccountMappings(raw: unknown, options: { allowEmpty?: boolean } = {}): Map<string, string> {
  const allowEmpty = options.allowEmpty ?? false
  const parsed = parseRuntimeJsonConfig(raw, 'NUXT_HUB_ACCOUNT_MAPPINGS_JSON')

  if (parsed === null) {
    if (allowEmpty) {
      return new Map()
    }
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable: NUXT_HUB_ACCOUNT_MAPPINGS_JSON is not configured.',
    })
  }

  const map = new Map<string, string>()

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (
        !item ||
        typeof item !== 'object' ||
        typeof (item as Record<string, unknown>).email !== 'string' ||
        typeof (item as Record<string, unknown>).uid !== 'string'
      ) {
        throw createError({
          statusCode: 503,
          statusMessage: 'Service Unavailable: NUXT_HUB_ACCOUNT_MAPPINGS_JSON contains an invalid mapping entry.',
        })
      }
      const email = normalizeHubEmail((item as Record<string, unknown>).email as string)
      const uid = ((item as Record<string, unknown>).uid as string).trim()
      if (!SIMPLE_EMAIL_REGEX.test(email) || uid.length === 0 || uid.length > 128) {
        throw createError({
          statusCode: 503,
          statusMessage: 'Service Unavailable: NUXT_HUB_ACCOUNT_MAPPINGS_JSON contains an invalid mapping entry.',
        })
      }
      map.set(email, uid)
    }
  } else if (typeof parsed === 'object' && parsed !== null) {
    for (const [rawEmail, rawUid] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof rawUid !== 'string') {
        throw createError({
          statusCode: 503,
          statusMessage: 'Service Unavailable: NUXT_HUB_ACCOUNT_MAPPINGS_JSON contains an invalid mapping entry.',
        })
      }
      const email = normalizeHubEmail(rawEmail)
      const uid = rawUid.trim()
      if (!SIMPLE_EMAIL_REGEX.test(email) || uid.length === 0 || uid.length > 128) {
        throw createError({
          statusCode: 503,
          statusMessage: 'Service Unavailable: NUXT_HUB_ACCOUNT_MAPPINGS_JSON contains an invalid mapping entry.',
        })
      }
      map.set(email, uid)
    }
  } else {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable: NUXT_HUB_ACCOUNT_MAPPINGS_JSON must be a JSON array or object.',
    })
  }

  if (map.size === 0 && !allowEmpty) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable: No valid Hub account mappings configured.',
    })
  }

  return map
}

export function resolveMappedFirebaseUid(rawEmail: unknown, rawMappingsJson: unknown): {
  email: string
  uid: string
} {
  const email = validateAndNormalizeHubEmail(rawEmail)
  const mappings = parseHubAccountMappings(rawMappingsJson, { allowEmpty: false })
  const uid = mappings.get(email)
  if (!uid) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden: Hub account is not mapped to a MiraiStudy user.',
    })
  }

  return { email, uid }
}

export function hasFirebaseAuthErrorCode(err: unknown, code: string): boolean {
  if (err && typeof err === 'object') {
    const errorRecord = err as Record<string, unknown>
    if (errorRecord.code === code) {
      return true
    }
    if (errorRecord.errorInfo && typeof errorRecord.errorInfo === 'object') {
      return (errorRecord.errorInfo as Record<string, unknown>).code === code
    }
  }
  return false
}

export async function resolveHubFirebaseUser(options: {
  rawEmail: unknown
  rawMappingsJson: unknown
  autoProvisionEnabled: boolean
  auth?: FirebaseAuthAdapter
  parsedMappings?: Map<string, string>
}): Promise<{ email: string; uid: string }> {
  const email = validateAndNormalizeHubEmail(options.rawEmail)
  const mappings = options.parsedMappings ?? parseHubAccountMappings(options.rawMappingsJson, { allowEmpty: options.autoProvisionEnabled })
  const mappedUid = mappings.get(email)
  const auth = options.auth ?? getAdminAuth()

  if (mappedUid) {
    let userRecord: FirebaseAuthUserLike
    try {
      userRecord = await auth.getUser(mappedUid)
    } catch (err) {
      if (hasFirebaseAuthErrorCode(err, 'auth/user-not-found')) {
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

    return { email, uid: userRecord.uid }
  }

  if (!options.autoProvisionEnabled) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden: Hub account is not mapped to a MiraiStudy user.',
    })
  }

  let userRecord: FirebaseAuthUserLike
  try {
    userRecord = await auth.getUserByEmail(email)
  } catch (err) {
    if (!hasFirebaseAuthErrorCode(err, 'auth/user-not-found')) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Service Unavailable: Failed to look up MiraiStudy account.',
      })
    }

    try {
      userRecord = await auth.createUser({ email, emailVerified: true })
    } catch (createErr) {
      if (hasFirebaseAuthErrorCode(createErr, 'auth/email-already-exists')) {
        try {
          userRecord = await auth.getUserByEmail(email)
        } catch {
          throw createError({
            statusCode: 503,
            statusMessage: 'Service Unavailable: Failed to resolve MiraiStudy account after creation conflict.',
          })
        }
      } else {
        throw createError({
          statusCode: 503,
          statusMessage: 'Service Unavailable: Failed to provision MiraiStudy account.',
        })
      }
    }
  }

  if (userRecord.disabled) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden: MiraiStudy account is disabled.',
    })
  }

  if (!userRecord.emailVerified) {
    try {
      await auth.updateUser(userRecord.uid, { emailVerified: true })
    } catch {
      throw createError({
        statusCode: 503,
        statusMessage: 'Service Unavailable: Failed to update MiraiStudy account verification status.',
      })
    }
  }

  return { email, uid: userRecord.uid }
}
