import { createError } from 'h3'

export function parseBooleanRuntimeFlag(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null) {
    return defaultValue
  }
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === '') {
      return defaultValue
    }
    if (normalized === 'true') {
      return true
    }
    if (normalized === 'false') {
      return false
    }
    return false // Fail-Closed for invalid string
  }
  return false // Fail-Closed for other types
}

export function parseRuntimeJsonConfig(raw: unknown, envName: string): unknown | null {
  if (raw === undefined || raw === null) {
    return null
  }
  if (Array.isArray(raw) || (typeof raw === 'object' && raw !== null)) {
    return raw
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
      return null
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw createError({
        statusCode: 503,
        statusMessage: `Service Unavailable: ${envName} is malformed.`,
      })
    }

    if (typeof parsed === 'string') {
      const innerTrimmed = parsed.trim()
      if (innerTrimmed.length === 0) {
        return null
      }
      try {
        parsed = JSON.parse(innerTrimmed)
      } catch {
        throw createError({
          statusCode: 503,
          statusMessage: `Service Unavailable: ${envName} is malformed.`,
        })
      }
    }

    return parsed
  }

  throw createError({
    statusCode: 503,
    statusMessage: `Service Unavailable: ${envName} is malformed.`,
  })
}
