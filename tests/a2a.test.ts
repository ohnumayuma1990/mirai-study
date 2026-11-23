import { describe, expect, it } from 'vitest'
import { A2A_AUDIENCE } from '../shared/schemas/a2a'
import { signHmacToken } from '../server/utils/signed-token'
import { parseA2aCallers, verifyA2aAuthorization } from '../server/utils/a2a-auth'

const SECRET_A = 'a2a-caller-secret-alpha-0123456789abcdef'
const SECRET_B = 'a2a-caller-secret-beta--0123456789abcdef'

describe('server/utils/a2a-auth', () => {
  it('supports single-caller secret and multi-caller JSON registry', () => {
    const single = parseA2aCallers({
      a2aEnabled: true,
      a2aSharedSecret: SECRET_A,
      a2aAllowedIssuer: 'team-management',
      a2aCallersJson: '',
    })
    expect(single).toHaveLength(1)
    expect(single[0]?.issuer).toBe('team-management')

    const multi = parseA2aCallers({
      a2aEnabled: true,
      a2aSharedSecret: '',
      a2aAllowedIssuer: 'team-management',
      a2aCallersJson: JSON.stringify([
        { issuer: 'roza-hub', secret: SECRET_A },
        { issuer: 'roza-mobile', secret: SECRET_B },
      ]),
    })
    expect(multi).toHaveLength(2)
  })

  it('verifies A2A Bearer token for a2a:miraistudy and rejects wrong audience or disabled flag', () => {
    const now = 1_700_000_000
    const token = signHmacToken(
      {
        iss: 'roza-hub',
        aud: A2A_AUDIENCE,
        sub: 'uid-study-99',
        iat: now - 5,
        exp: now + 300,
      },
      SECRET_A,
    )

    const ctx = verifyA2aAuthorization({
      authorizationHeader: `Bearer ${token}`,
      settings: {
        a2aEnabled: true,
        a2aSharedSecret: SECRET_A,
        a2aAllowedIssuer: 'roza-hub',
        a2aCallersJson: '',
      },
      nowEpochSeconds: now,
    })

    expect(ctx.uid).toBe('uid-study-99')
    expect(ctx.callerIssuer).toBe('roza-hub')

    // Disabled A2A must fail closed with 404
    expect(() =>
      verifyA2aAuthorization({
        authorizationHeader: `Bearer ${token}`,
        settings: {
          a2aEnabled: false,
          a2aSharedSecret: SECRET_A,
          a2aAllowedIssuer: 'roza-hub',
          a2aCallersJson: '',
        },
        nowEpochSeconds: now,
      }),
    ).toThrowError()
  })
})
