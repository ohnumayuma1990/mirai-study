import { createError, getHeader, type H3Event } from 'h3'
import { A2A_AUDIENCE } from '../../shared/schemas/a2a'
import { extractBearerToken } from './auth'
import { verifyHmacToken, type SignedTokenPayload } from './signed-token'

export interface A2aCallerConfig {
  issuer: string
  secret: string
}

export interface A2aAuthContext {
  callerIssuer: string
  uid: string
  payload: SignedTokenPayload
}

export interface A2aRuntimeSettings {
  a2aEnabled: boolean
  a2aSharedSecret: string
  a2aAllowedIssuer: string
  a2aCallersJson: string
}

export function parseA2aCallers(settings: A2aRuntimeSettings): A2aCallerConfig[] {
  const trimmedJson = settings.a2aCallersJson.trim()
  if (trimmedJson.length > 0) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmedJson)
    } catch {
      throw createError({
        statusCode: 503,
        statusMessage: 'Service Unavailable: NUXT_A2A_CALLERS_JSON is malformed.',
      })
    }

    if (!Array.isArray(parsed)) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Service Unavailable: NUXT_A2A_CALLERS_JSON must be a JSON array.',
      })
    }

    const callers: A2aCallerConfig[] = []
    for (const item of parsed) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as Record<string, unknown>).issuer === 'string' &&
        typeof (item as Record<string, unknown>).secret === 'string'
      ) {
        const issuer = ((item as Record<string, unknown>).issuer as string).trim()
        const secret = ((item as Record<string, unknown>).secret as string).trim()
        if (issuer.length > 0 && secret.length >= 32) {
          callers.push({ issuer, secret })
        }
      }
    }

    if (callers.length === 0) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Service Unavailable: No valid A2A callers configured.',
      })
    }
    return callers
  }

  if (settings.a2aSharedSecret.length >= 32 && settings.a2aAllowedIssuer.trim().length > 0) {
    return [
      {
        issuer: settings.a2aAllowedIssuer.trim(),
        secret: settings.a2aSharedSecret,
      },
    ]
  }

  throw createError({
    statusCode: 503,
    statusMessage: 'Service Unavailable: A2A shared secret is not configured.',
  })
}

export function verifyA2aAuthorization(params: {
  authorizationHeader: string | undefined
  settings: A2aRuntimeSettings
  nowEpochSeconds?: number
}): A2aAuthContext {
  if (!params.settings.a2aEnabled) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found: A2A endpoint is disabled.',
    })
  }

  const callers = parseA2aCallers(params.settings)
  const token = extractBearerToken(params.authorizationHeader)
  if (!token) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized: Missing A2A Bearer token.',
    })
  }

  for (const caller of callers) {
    try {
      const payload = verifyHmacToken(token, {
        secret: caller.secret,
        expectedAudience: A2A_AUDIENCE,
        expectedIssuer: caller.issuer,
        nowEpochSeconds: params.nowEpochSeconds,
      })
      return {
        callerIssuer: caller.issuer,
        uid: payload.sub,
        payload,
      }
    } catch {
      // Try next configured caller
    }
  }

  throw createError({
    statusCode: 401,
    statusMessage: 'Unauthorized: Invalid A2A token.',
  })
}

export function requireA2aCaller(event: H3Event): A2aAuthContext {
  const config = useRuntimeConfig()
  const settings: A2aRuntimeSettings = {
    a2aEnabled: Boolean(config.a2aEnabled),
    a2aSharedSecret: String(config.a2aSharedSecret ?? ''),
    a2aAllowedIssuer: String(config.a2aAllowedIssuer ?? 'team-management'),
    a2aCallersJson: String(config.a2aCallersJson ?? ''),
  }

  return verifyA2aAuthorization({
    authorizationHeader: getHeader(event, 'authorization'),
    settings,
  })
}
