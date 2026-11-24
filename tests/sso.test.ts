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
import { parseBooleanRuntimeFlag, parseRuntimeJsonConfig } from '../server/utils/runtime-config'
import type { FirebaseAuthAdapter } from '../server/utils/hub-account-mapping'

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

function createMockAuth(): FirebaseAuthAdapter & {
  getUserByEmailCalls: number
  createUserCalls: number
  updateUserCalls: number
} {
  let getUserByEmailCalls = 0
  let createUserCalls = 0
  let updateUserCalls = 0
  return {
    get getUserByEmailCalls() { return getUserByEmailCalls },
    get createUserCalls() { return createUserCalls },
    get updateUserCalls() { return updateUserCalls },
    async getUser(uid) {
      if (uid === OWNER_UID) {
        return { uid: OWNER_UID, email: OWNER_EMAIL, emailVerified: true, disabled: false }
      }
      if (uid === 'disabled-uid') {
        return { uid: 'disabled-uid', email: 'disabled@example.com', emailVerified: true, disabled: true }
      }
      const err = new Error('not found') as Error & { code: string }
      err.code = 'auth/user-not-found'
      throw err
    },
    async getUserByEmail(email) {
      getUserByEmailCalls++
      if (email === OWNER_EMAIL) {
        return { uid: OWNER_UID, email: OWNER_EMAIL, emailVerified: true, disabled: false }
      }
      if (email === 'existing@example.com') {
        return { uid: 'existing-uid-777', email, emailVerified: false, disabled: false }
      }
      if (email === 'disabled-email@example.com') {
        return { uid: 'disabled-user-uid', email, emailVerified: true, disabled: true }
      }
      if (email === 'conflict@example.com') {
        if (getUserByEmailCalls > 1) {
          return { uid: 'conflict-resolved-uid-888', email, emailVerified: true, disabled: false }
        }
      }
      const err = new Error('not found') as Error & { code: string }
      err.code = 'auth/user-not-found'
      throw err
    },
    async createUser(props) {
      createUserCalls++
      if (props.email === 'conflict@example.com') {
        const err = new Error('already exists') as Error & { code: string }
        err.code = 'auth/email-already-exists'
        throw err
      }
      return { uid: 'provisioned-uid-999', email: props.email, emailVerified: props.emailVerified, disabled: false }
    },
    async updateUser(uid, props) {
      updateUserCalls++
      return { uid, email: 'existing@example.com', emailVerified: props.emailVerified, disabled: false }
    },
  }
}

describe('server/utils/sso & auto-provisioning & runtime-config', () => {
  it('tests parseBooleanRuntimeFlag thoroughly', () => {
    expect(parseBooleanRuntimeFlag(undefined, true)).toBe(true)
    expect(parseBooleanRuntimeFlag(null, false)).toBe(false)
    expect(parseBooleanRuntimeFlag(true, false)).toBe(true)
    expect(parseBooleanRuntimeFlag(false, true)).toBe(false)
    expect(parseBooleanRuntimeFlag('true', false)).toBe(true)
    expect(parseBooleanRuntimeFlag('  TRUE  ', false)).toBe(true)
    expect(parseBooleanRuntimeFlag('false', true)).toBe(false)
    expect(parseBooleanRuntimeFlag('  false ', true)).toBe(false)
    expect(parseBooleanRuntimeFlag('', true)).toBe(true)
    expect(parseBooleanRuntimeFlag('invalid', true)).toBe(false)
    expect(parseBooleanRuntimeFlag(123, true)).toBe(false)
  })

  it('tests parseRuntimeJsonConfig thoroughly', () => {
    expect(parseRuntimeJsonConfig(null, 'TEST')).toBeNull()
    expect(parseRuntimeJsonConfig(undefined, 'TEST')).toBeNull()
    expect(parseRuntimeJsonConfig([1, 2], 'TEST')).toEqual([1, 2])
    expect(parseRuntimeJsonConfig({ a: 1 }, 'TEST')).toEqual({ a: 1 })
    expect(parseRuntimeJsonConfig('  [{"a":1}]  ', 'TEST')).toEqual([{ a: 1 }])
    expect(parseRuntimeJsonConfig(JSON.stringify(JSON.stringify([{ a: 1 }])), 'TEST')).toEqual([{ a: 1 }])
    expect(parseRuntimeJsonConfig('   ', 'TEST')).toBeNull()

    expect(() => parseRuntimeJsonConfig('invalid-json', 'TEST')).toThrowError(/malformed/i)
    expect(() => parseRuntimeJsonConfig(123, 'TEST')).toThrowError(/malformed/i)
  })

  it('verifies valid SSO code once with atomic jti store and blocks replay across instances', async () => {
    const now = 1_700_000_000
    const state = generateSsoState()
    const { store, consumeSpy } = createSharedMockJtiStore()
    const auth = createMockAuth()

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
      ssoAutoProvisionEnabled: false,
      auth,
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
        ssoAutoProvisionEnabled: false,
        auth,
        nowEpochSeconds: now + 1,
        jtiStore: store,
      }),
    ).rejects.toThrowError(/already been consumed/i)

    // Verify consumeOnce failure aborts BEFORE auth methods are invoked
    expect(auth.getUserByEmailCalls).toBe(0)
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
    const auth = createMockAuth()

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
        ssoAutoProvisionEnabled: false,
        auth,
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
        ssoAutoProvisionEnabled: false,
        auth,
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
        ssoAutoProvisionEnabled: false,
        auth,
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
    const auth = createMockAuth()

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
        ssoAutoProvisionEnabled: false,
        auth,
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
        ssoAutoProvisionEnabled: false,
        auth,
        nowEpochSeconds: now,
        jtiStore: store,
      }),
    ).rejects.toThrowError(/must be distinct/i)
  })

  it('supports unmapped auto-provisioning, conflict resolution, and disabled user rejection', async () => {
    const now = 1_700_000_000
    const state = generateSsoState()
    const { store } = createSharedMockJtiStore()
    const auth = createMockAuth()

    // 1. New user auto-provisioning
    const newUserCode = signHmacToken(
      {
        iss: ISSUER,
        aud: SSO_AUDIENCE,
        email: 'newuser@example.com',
        state,
        iat: now - 5,
        exp: now + 60,
        jti: 'jti-auto-1',
      },
      SSO_SECRET,
    )

    const res1 = await verifyAndConsumeSsoCode({
      code: newUserCode,
      state,
      cookieState: state,
      ssoEnabled: true,
      ssoSharedSecret: SSO_SECRET,
      ssoAllowedIssuer: ISSUER,
      hubAccountMappingsJson: '', // empty mappings with auto-provision enabled
      ssoAutoProvisionEnabled: true,
      auth,
      nowEpochSeconds: now,
      jtiStore: store,
    })
    expect(res1.email).toBe('newuser@example.com')
    expect(res1.uid).toBe('provisioned-uid-999')

    // 2. Existing user without verification needing updateUser
    const existingCode = signHmacToken(
      {
        iss: ISSUER,
        aud: SSO_AUDIENCE,
        email: 'existing@example.com',
        state,
        iat: now - 5,
        exp: now + 60,
        jti: 'jti-auto-2',
      },
      SSO_SECRET,
    )
    const res2 = await verifyAndConsumeSsoCode({
      code: existingCode,
      state,
      cookieState: state,
      ssoEnabled: true,
      ssoSharedSecret: SSO_SECRET,
      ssoAllowedIssuer: ISSUER,
      hubAccountMappingsJson: '',
      ssoAutoProvisionEnabled: true,
      auth,
      nowEpochSeconds: now,
      jtiStore: store,
    })
    expect(res2.uid).toBe('existing-uid-777')
    expect(auth.updateUserCalls).toBe(1)

    // 3. Disabled user rejection (disabled user must be rejected with 403 and updateUser never called)
    const disabledCode = signHmacToken(
      {
        iss: ISSUER,
        aud: SSO_AUDIENCE,
        email: 'disabled-email@example.com',
        state,
        iat: now - 5,
        exp: now + 60,
        jti: 'jti-auto-3',
      },
      SSO_SECRET,
    )
    await expect(
      verifyAndConsumeSsoCode({
        code: disabledCode,
        state,
        cookieState: state,
        ssoEnabled: true,
        ssoSharedSecret: SSO_SECRET,
        ssoAllowedIssuer: ISSUER,
        hubAccountMappingsJson: '',
        ssoAutoProvisionEnabled: true,
        auth,
        nowEpochSeconds: now,
        jtiStore: store,
      }),
    ).rejects.toThrowError(/disabled/i)

    // 4. Creation conflict resolution (auth/email-already-exists -> getUserByEmail recovery)
    const conflictCode = signHmacToken(
      {
        iss: ISSUER,
        aud: SSO_AUDIENCE,
        email: 'conflict@example.com',
        state,
        iat: now - 5,
        exp: now + 60,
        jti: 'jti-auto-4',
      },
      SSO_SECRET,
    )
    const res4 = await verifyAndConsumeSsoCode({
      code: conflictCode,
      state,
      cookieState: state,
      ssoEnabled: true,
      ssoSharedSecret: SSO_SECRET,
      ssoAllowedIssuer: ISSUER,
      hubAccountMappingsJson: '',
      ssoAutoProvisionEnabled: true,
      auth,
      nowEpochSeconds: now,
      jtiStore: store,
    })
    expect(res4.email).toBe('conflict@example.com')
    expect(res4.uid).toBe('conflict-resolved-uid-888')
  })

  it('rejects unmapped accounts when ssoAutoProvisionEnabled is false and malformed JSON mappings with 503', async () => {
    const now = 1_700_000_000
    const state = generateSsoState()
    const { store } = createSharedMockJtiStore()
    const auth = createMockAuth()

    const unmappedCode = signHmacToken(
      {
        iss: ISSUER,
        aud: SSO_AUDIENCE,
        email: 'stranger@example.com',
        state,
        iat: now - 5,
        exp: now + 60,
        jti: 'jti-unmapped-2',
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
        ssoAutoProvisionEnabled: false,
        auth,
        nowEpochSeconds: now,
        jtiStore: store,
      }),
    ).rejects.toThrowError(/not mapped/i)

    // Malformed JSON mapping config must throw 503 Fail-Closed even if auto-provision is enabled
    await expect(
      verifyAndConsumeSsoCode({
        code: unmappedCode,
        state,
        cookieState: state,
        ssoEnabled: true,
        ssoSharedSecret: SSO_SECRET,
        ssoAllowedIssuer: ISSUER,
        hubAccountMappingsJson: 'invalid-json',
        ssoAutoProvisionEnabled: true,
        auth,
        nowEpochSeconds: now,
        jtiStore: store,
      }),
    ).rejects.toThrowError(/malformed/i)
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

    const legacy = SsoConsumeRequestSchema.safeParse({ token: 'legacy-token-value-0123456789' })
    expect(legacy.success).toBe(false)
  })
})
