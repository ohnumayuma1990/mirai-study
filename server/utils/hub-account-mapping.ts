import { createError } from 'h3'

export interface HubAccountMapping {
  email: string
  uid: string
}

const SIMPLE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeHubEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function parseHubAccountMappings(rawJson: string): Map<string, string> {
  const trimmed = rawJson.trim()
  if (trimmed.length === 0) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable: NUXT_HUB_ACCOUNT_MAPPINGS_JSON is not configured.',
    })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable: NUXT_HUB_ACCOUNT_MAPPINGS_JSON is malformed.',
    })
  }

  const map = new Map<string, string>()

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as Record<string, unknown>).email === 'string' &&
        typeof (item as Record<string, unknown>).uid === 'string'
      ) {
        const email = normalizeHubEmail((item as Record<string, unknown>).email as string)
        const uid = ((item as Record<string, unknown>).uid as string).trim()
        if (SIMPLE_EMAIL_REGEX.test(email) && uid.length > 0 && uid.length <= 128) {
          map.set(email, uid)
        }
      }
    }
  } else if (parsed && typeof parsed === 'object') {
    for (const [rawEmail, rawUid] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof rawUid === 'string') {
        const email = normalizeHubEmail(rawEmail)
        const uid = rawUid.trim()
        if (SIMPLE_EMAIL_REGEX.test(email) && uid.length > 0 && uid.length <= 128) {
          map.set(email, uid)
        }
      }
    }
  } else {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable: NUXT_HUB_ACCOUNT_MAPPINGS_JSON must be a JSON array or object.',
    })
  }

  if (map.size === 0) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable: No valid Hub account mappings configured.',
    })
  }

  return map
}

export function resolveMappedFirebaseUid(rawEmail: unknown, rawMappingsJson: string): {
  email: string
  uid: string
} {
  if (typeof rawEmail !== 'string' || !SIMPLE_EMAIL_REGEX.test(normalizeHubEmail(rawEmail))) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized: Verified Hub email claim is missing or invalid.',
    })
  }

  const mappings = parseHubAccountMappings(rawMappingsJson)
  const email = normalizeHubEmail(rawEmail)
  const uid = mappings.get(email)
  if (!uid) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden: Hub account is not mapped to a MiraiStudy user.',
    })
  }

  return { email, uid }
}
