import { createError, getHeader, type H3Event } from 'h3'
import { A2A_AUDIENCE, A2aScopeSchema, type A2aScope } from '../../shared/schemas/a2a'
import { extractBearerToken } from './auth'
import { resolveMappedFirebaseUid } from './hub-account-mapping'
import { verifyHmacToken, type SignedTokenPayload } from './signed-token'
import { assertSsoAndA2aSecretsDistinct } from './sso'

export interface A2aCallerConfig {
  issuer: string
  secret: string
}

export interface A2aAuthContext {
  callerIssuer: string
  callerSecret: string
  scopes: A2aScope[]
  uid: string | null
  email: string | null
  payload: SignedTokenPayload
}

export interface A2aRuntimeSettings {
  a2aEnabled: boolean
  a2aWriteEnabled?: boolean
  a2aSharedSecret: string
  a2aAllowedIssuer: string
  a2aCallersJson: string
  hubAccountMappingsJson?: string
  ssoSharedSecret?: string
}

export interface VerifyA2aOptions {
  authorizationHeader: string | undefined
  settings: A2aRuntimeSettings
  requiredScope?: A2aScope
  requireUser?: boolean
  nowEpochSeconds?: number
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

function parseTokenScopes(rawScopes: unknown): A2aScope[] {
  if (!Array.isArray(rawScopes) || rawScopes.length === 0) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden: A2A token scopes claim is missing or empty.',
    })
  }

  const scopes: A2aScope[] = []
  for (const item of rawScopes) {
    const parsed = A2aScopeSchema.safeParse(item)
    if (!parsed.success) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden: A2A token contains unsupported scope.',
      })
    }
    if (!scopes.includes(parsed.data)) {
      scopes.push(parsed.data)
    }
  }
  return scopes
}

export function verifyA2aAuthorization(params: VerifyA2aOptions): A2aAuthContext {
  if (!params.settings.a2aEnabled) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found: A2A endpoint is disabled.',
    })
  }

  assertSsoAndA2aSecretsDistinct(
    params.settings.ssoSharedSecret ?? '',
    params.settings.a2aSharedSecret,
    params.settings.a2aCallersJson,
  )

  const callers = parseA2aCallers(params.settings)
  const token = extractBearerToken(params.authorizationHeader)
  if (!token) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized: Missing A2A Bearer token.',
    })
  }

  let matchedCaller: A2aCallerConfig | null = null
  let verifiedPayload: SignedTokenPayload | null = null

  for (const caller of callers) {
    try {
      verifiedPayload = verifyHmacToken(token, {
        secret: caller.secret,
        expectedAudience: A2A_AUDIENCE,
        expectedIssuer: caller.issuer,
        requireSub: false,
        nowEpochSeconds: params.nowEpochSeconds,
      })
      matchedCaller = caller
      break
    } catch {
      // Try next configured caller
    }
  }

  if (!matchedCaller || !verifiedPayload) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized: Invalid A2A token.',
    })
  }

  const scopes = parseTokenScopes(verifiedPayload.scopes)
  const requiredScope = params.requiredScope ?? 'read'

  if (requiredScope === 'write' && !params.settings.a2aWriteEnabled) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden: A2A write operations are disabled.',
    })
  }

  if (!scopes.includes(requiredScope)) {
    throw createError({
      statusCode: 403,
      statusMessage: `Forbidden: A2A token lacks required '${requiredScope}' scope.`,
    })
  }

  const requireUser = params.requireUser ?? true
  if (!requireUser) {
    return {
      callerIssuer: matchedCaller.issuer,
      callerSecret: matchedCaller.secret,
      scopes,
      uid: null,
      email: null,
      payload: verifiedPayload,
    }
  }

  const mapped = resolveMappedFirebaseUid(
    verifiedPayload.email,
    params.settings.hubAccountMappingsJson ?? '',
  )

  return {
    callerIssuer: matchedCaller.issuer,
    callerSecret: matchedCaller.secret,
    scopes,
    uid: mapped.uid,
    email: mapped.email,
    payload: verifiedPayload,
  }
}

export function assertA2aWriteAllowed(
  caller: A2aAuthContext,
  a2aWriteEnabled: boolean,
): void {
  if (!a2aWriteEnabled) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden: A2A write operations are disabled.',
    })
  }
  if (!caller.scopes.includes('write')) {
    throw createError({
      statusCode: 403,
      statusMessage: "Forbidden: A2A token lacks required 'write' scope.",
    })
  }
}

export function requireA2aCaller(
  event: H3Event,
  options: { requiredScope?: A2aScope; requireUser?: boolean } = {},
): A2aAuthContext {
  const config = useRuntimeConfig()
  const settings: A2aRuntimeSettings = {
    a2aEnabled: Boolean(config.a2aEnabled),
    a2aWriteEnabled: Boolean(config.a2aWriteEnabled),
    a2aSharedSecret: String(config.a2aSharedSecret ?? ''),
    a2aAllowedIssuer: String(config.a2aAllowedIssuer ?? 'team-management'),
    a2aCallersJson: String(config.a2aCallersJson ?? ''),
    hubAccountMappingsJson: String(config.hubAccountMappingsJson ?? ''),
    ssoSharedSecret: String(config.ssoSharedSecret ?? ''),
  }

  return verifyA2aAuthorization({
    authorizationHeader: getHeader(event, 'authorization'),
    settings,
    requiredScope: options.requiredScope,
    requireUser: options.requireUser,
  })
}
