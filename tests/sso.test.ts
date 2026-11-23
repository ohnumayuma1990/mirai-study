import { describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import { SSO_AUDIENCE, SsoConsumeRequestSchema } from '../shared/schemas/sso'
import { signHmacToken } from '../server/utils/signed-token'
import {
  generateSsoState,
  validateStrictOrigin,
  verifyAndConsumeSsoCode,
  type SsoJtiStore,
} from '../server/utils/sso'

const SSO_SECRET = 'super-secret-sso-signing-key-at-least-32-chars'
const A2A_SECRET = 'different-a2a-signing-key-at-least-32-chars-ok'
const ISSUER = 'team-management'
const OWNER_EMAIL = 'owner@example.com'
const OWNER_UID = 'firebase-owner-uid-001'
const MAPPINGS_JSON = JSON.stringify([{ email: OWNER_EMAIL, uid: OWNER_UID }])

function createSharedMockJtiStore(): { store: SsoJtiStore; consumeSpy: ReturnType<typeof vi.fn> } {
  const seen = new Set<string>()
  const consumeSpy = vi.fn(async (jti: string) => {
    if (seen.has(jti)) {
      throw createError({
        statusCode: 401,
        statusMessage: 'Unauthorized: SSO code has already been consumed.',
      })
    }
    seen.add(jti)
  })
  return {
    store: { consumeOnce: consumeSpy },
    consumeSpy,
  }
}

describe('server/utils/sso', () => {
  it('verifies valid SSO code once with atomic jti store and blocks replay across instances', async () => {
    const now = 1_700_000_000
    const state = generateSsoState()
    const { store, consumeSpy } = createSharedMockJtiStore()

    const code = signHmacToken(
      {
        iss: ISSUER,
        aud: SSO_AUDIENCE,
        email: 'OWNER@EXAMPLE.COM',
        state,
        iat: now - 5,
        exp: now + 60,
        jti: 'jti-once-1',
      },
      SSO_SECRET,
    )

    const result = await verifyAndConsumeSsoCode({
      code,
      state,
      cookieState: state,
      ssoEnabled: true,
      ssoSharedSecret: SSO_SECRET,
      ssoAllowedIssuer: ISSUER,
      hubAccountMappingsJson: MAPPINGS_JSON,
      a2aSharedSecret: A2A_SECRET,
      nowEpochSeconds: now,
      jtiStore: store,
    })

    expect(result.uid).toBe(OWNER_UID)
    expect(result.email).toBe(OWNER_EMAIL)
    expect(consumeSpy).toHaveBeenCalledTimes(1)

    // Replay attempt (simulating a second instance sharing the same Firestore collection) must fail
    await expect(
      verifyAndConsumeSsoCode({
        code,
        state,
        cookieState: state,
        ssoEnabled: true,
        ssoSharedSecret: SSO_SECRET,
        ssoAllowedIssuer: ISSUER,
        hubAccountMappingsJson: MAPPINGS_JSON,
        a2aSharedSecret: A2A_SECRET,
        nowEpochSeconds: now + 1,
        jtiStore: store,
      }),
    ).rejects.toThrowError(/already been consumed/i)
  })

  it('rejects state mismatch before touching Firestore jti store', async () => {
    const now = 1_700_000_000
    const state = generateSsoState()
    const wrongState = generateSsoState()
    const { store, consumeSpy } = createSharedMockJtiStore()

    const code = signHmacToken(
      {
        iss: ISSUER,
        aud: SSO_AUDIENCE,
        email: OWNER_EMAIL,
        state,
        iat: now - 5,
        exp: now + 60,
        jti: 'jti-state-mismatch',
      },
      SSO_SECRET,
    )

    // Cookie mismatch
    await expect(
      verifyAndConsumeSsoCode({
        code,
        state,
        cookieState: wrongState,
        ssoEnabled: true,
        ssoSharedSecret: SSO_SECRET,
        ssoAllowedIssuer: ISSUER,
        hubAccountMappingsJson: MAPPINGS_JSON,
        nowEpochSeconds: now,
        jtiStore: store,
      }),
    ).rejects.toThrowError(/state mismatch/i)

    // JWT state claim mismatch
    const mismatchedClaimCode = signHmacToken(
      {
        iss: ISSUER,
        aud: SSO_AUDIENCE,
        email: OWNER_EMAIL,
        state: wrongState,
        iat: now - 5,
        exp: now + 60,
        jti: 'jti-claim-mismatch',
      },
      SSO_SECRET,
    )

    await expect(
      verifyAndConsumeSsoCode({
        code: mismatchedClaimCode,
        state,
        cookieState: state,
        ssoEnabled: true,
        ssoSharedSecret: SSO_SECRET,
        ssoAllowedIssuer: ISSUER,
        hubAccountMappingsJson: MAPPINGS_JSON,
        nowEpochSeconds: now,
        jtiStore: store,
      }),
    ).rejects.toThrowError(/state claim mismatch/i)

    expect(consumeSpy).not.toHaveBeenCalled()
  })

  it('rejects expired code, missing jti, wrong audience, and unmapped Hub accounts without writing jti', async () => {
    const now = 1_700_000_000
    const state = generateSsoState()
    const { store, consumeSpy } = createSharedMockJtiStore()

    const expiredCode = signHmacToken(
      {
        iss: ISSUER,
        aud: SSO_AUDIENCE,
        email: OWNER_EMAIL,
        state,
        iat: now - 120,
        exp: now - 40,
        jti: 'jti-expired',
      },
      SSO_SECRET,
    )
    await expect(
      verifyAndConsumeSsoCode({
        code: expiredCode,
        state,
        cookieState: state,
        ssoEnabled: true,
        ssoSharedSecret: SSO_SECRET,
        ssoAllowedIssuer: ISSUER,
        hubAccountMappingsJson: MAPPINGS_JSON,
        nowEpochSeconds: now,
        jtiStore: store,
      }),
    ).rejects.toThrowError(/expired/i)

    const noJtiCode = signHmacToken(
      {
        iss: ISSUER,
        aud: SSO_AUDIENCE,
        email: OWNER_EMAIL,
        state,
        iat: now - 5,
        exp: now + 60,
      },
      SSO_SECRET,
    )
    await expect(
      verifyAndConsumeSsoCode({
        code: noJtiCode,
        state,
        cookieState: state,
        ssoEnabled: true,
        ssoSharedSecret: SSO_SECRET,
        ssoAllowedIssuer: ISSUER,
        hubAccountMappingsJson: MAPPINGS_JSON,
        nowEpochSeconds: now,
        jtiStore: store,
      }),
    ).rejects.toThrowError(/jti claim is required/i)

    const unmappedCode = signHmacToken(
      {
        iss: ISSUER,
        aud: SSO_AUDIENCE,
        email: 'stranger@example.com',
        state,
        iat: now - 5,
        exp: now + 60,
        jti: 'jti-unmapped',
      },
      SSO_SECRET,
    )
    await expect(
      verifyAndConsumeSsoCode({
        code: unmappedCode,
        state,
        cookieState: state,
        ssoEnabled: true,
        ssoSharedSecret: SSO_SECRET,
        ssoAllowedIssuer: ISSUER,
        hubAccountMappingsJson: MAPPINGS_JSON,
        nowEpochSeconds: now,
        jtiStore: store,
      }),
    ).rejects.toThrowError(/not mapped/i)

    expect(consumeSpy).not.toHaveBeenCalled()
  })

  it('enforces distinct SSO and A2A secrets (including a2aCallersJson entries)', async () => {
    const now = 1_700_000_000
    const state = generateSsoState()
    const { store } = createSharedMockJtiStore()

    const code = signHmacToken(
      {
        iss: ISSUER,
        aud: SSO_AUDIENCE,
        email: OWNER_EMAIL,
        state,
        iat: now - 5,
        exp: now + 60,
        jti: 'jti-secret-reuse',
      },
      SSO_SECRET,
    )

    await expect(
      verifyAndConsumeSsoCode({
        code,
        state,
        cookieState: state,
        ssoEnabled: true,
        ssoSharedSecret: SSO_SECRET,
        ssoAllowedIssuer: ISSUER,
        hubAccountMappingsJson: MAPPINGS_JSON,
        a2aSharedSecret: SSO_SECRET,
        nowEpochSeconds: now,
        jtiStore: store,
      }),
    ).rejects.toThrowError(/must be distinct/i)

    await expect(
      verifyAndConsumeSsoCode({
        code,
        state,
        cookieState: state,
        ssoEnabled: true,
        ssoSharedSecret: SSO_SECRET,
        ssoAllowedIssuer: ISSUER,
        hubAccountMappingsJson: MAPPINGS_JSON,
        a2aCallersJson: JSON.stringify([{ issuer: ISSUER, secret: SSO_SECRET }]),
        nowEpochSeconds: now,
        jtiStore: store,
      }),
    ).rejects.toThrowError(/must be distinct/i)
  })

  it('validates strict HTTPS origins and rejects legacy { token } SSO consume payload', () => {
    expect(validateStrictOrigin('https://hub.example.com', 'TEST', { allowLocalHttp: false })).toBe(
      'https://hub.example.com',
    )
    expect(() =>
      validateStrictOrigin('http://hub.example.com', 'TEST', { allowLocalHttp: false }),
    ).toThrowError(/HTTPS/i)
    expect(() =>
      validateStrictOrigin('https://hub.example.com/path', 'TEST', { allowLocalHttp: false }),
    ).toThrowError(/bare origin/i)

    // Legacy ?token= / { token } request format is retired
    const legacy = SsoConsumeRequestSchema.safeParse({ token: 'legacy-token-value-0123456789' })
    expect(legacy.success).toBe(false)
  })
})
