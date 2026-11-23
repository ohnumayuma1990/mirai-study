import { describe, expect, it, vi } from 'vitest'
import {
  extractBearerToken,
  validateSsoFreshness,
  verifyBearerTokenWithVerifier,
} from '../server/utils/auth'

describe('server/utils/auth', () => {
  it('extracts Bearer token case-insensitively and rejects malformed headers', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi')
    expect(extractBearerToken('bearer token123')).toBe('token123')
    expect(extractBearerToken('Basic xyz')).toBeNull()
    expect(extractBearerToken(undefined)).toBeNull()
  })

  it('rejects missing token with 401', async () => {
    const verifier = vi.fn()
    await expect(
      verifyBearerTokenWithVerifier({
        authorizationHeader: undefined,
        ssoEnabled: false,
        verifyIdToken: verifier,
      }),
    ).rejects.toMatchObject({ statusCode: 401 })
    expect(verifier).not.toHaveBeenCalled()
  })

  it('calls verifyIdToken with checkRevoked=true and returns uid', async () => {
    const verifier = vi.fn().mockResolvedValue({ uid: 'user-1', email: 'u@example.com' })
    const res = await verifyBearerTokenWithVerifier({
      authorizationHeader: 'Bearer valid-token',
      ssoEnabled: false,
      verifyIdToken: verifier,
    })

    expect(verifier).toHaveBeenCalledWith('valid-token', true)
    expect(res.uid).toBe('user-1')
  })

  it('enforces 1-hour sso_at freshness when ssoEnabled is true', () => {
    const now = 1_700_000_000
    expect(validateSsoFreshness({ uid: 'u1', sso_at: now - 300 }, true, now)).toBe(now - 300)

    expect(() => validateSsoFreshness({ uid: 'u1' }, true, now)).toThrowError()
    expect(() => validateSsoFreshness({ uid: 'u1', sso_at: now - 4000 }, true, now)).toThrowError()
  })
})
