import { beforeEach, describe, expect, it } from 'vitest'
import { SSO_AUDIENCE } from '../shared/schemas/sso'
import { signHmacToken } from '../server/utils/signed-token'
import { resetConsumedSsoTokensForTest, verifyAndConsumeSsoToken } from '../server/utils/sso'

const SECRET = 'super-secret-sso-signing-key-at-least-32-chars'
const ORIGIN = 'https://roza.example.com'

describe('server/utils/sso', () => {
  beforeEach(() => {
    resetConsumedSsoTokensForTest()
  })

  it('verifies valid SSO token once and blocks replay by jti', () => {
    const now = 1_700_000_000
    const token = signHmacToken(
      {
        iss: ORIGIN,
        aud: SSO_AUDIENCE,
        sub: 'user-sso-1',
        iat: now - 5,
        exp: now + 120,
        jti: 'jti-once-1',
      },
      SECRET,
    )

    const result = verifyAndConsumeSsoToken({
      token,
      ssoEnabled: true,
      ssoSharedSecret: SECRET,
      ssoProviderOrigin: ORIGIN,
      nowEpochSeconds: now,
    })
    expect(result.uid).toBe('user-sso-1')

    // Replay attempt must fail
    expect(() =>
      verifyAndConsumeSsoToken({
        token,
        ssoEnabled: true,
        ssoSharedSecret: SECRET,
        ssoProviderOrigin: ORIGIN,
        nowEpochSeconds: now + 1,
      }),
    ).toThrowError()
  })

  it('fails closed when SSO is disabled or audience mismatches', () => {
    const now = 1_700_000_000
    const token = signHmacToken(
      {
        iss: ORIGIN,
        aud: 'sso:wrong-app',
        sub: 'user-sso-1',
        iat: now - 5,
        exp: now + 120,
      },
      SECRET,
    )

    expect(() =>
      verifyAndConsumeSsoToken({
        token,
        ssoEnabled: false,
        ssoSharedSecret: SECRET,
        ssoProviderOrigin: ORIGIN,
        nowEpochSeconds: now,
      }),
    ).toThrowError()

    expect(() =>
      verifyAndConsumeSsoToken({
        token,
        ssoEnabled: true,
        ssoSharedSecret: SECRET,
        ssoProviderOrigin: ORIGIN,
        nowEpochSeconds: now,
      }),
    ).toThrowError()
  })
})
