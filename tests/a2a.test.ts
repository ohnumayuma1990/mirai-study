import { describe, expect, it } from 'vitest'
import { A2A_AUDIENCE, A2A_EXTENSION_HITL_FORM } from '../shared/schemas/a2a'
import { A2A_EXTENSION_STUDY_TRACK, A2A_STUDY_TRACK_SKILL, StudyTrackGoalConfirmSchema } from '../shared/schemas/study-track-goal'
import { signHmacToken, verifyAgentSignature } from '../server/utils/signed-token'
import { parseA2aCallers, verifyA2aAuthorization } from '../server/utils/a2a-auth'
import { buildSignedAgentCard } from '../server/routes/.well-known/agent-card.json.get'
import { buildSendMessageSummaryResponse, formatStudySummaryText } from '../server/api/a2a/v1.post'

const SECRET_A = 'a2a-caller-secret-alpha-0123456789abcdef'
const SECRET_B = 'a2a-caller-secret-beta--0123456789abcdef'
const SSO_SECRET = 'sso-independent-secret--0123456789abcdef'
const OWNER_EMAIL = 'owner@example.com'
const OWNER_UID = 'uid-study-owner-99'
const MAPPINGS_JSON = JSON.stringify([{ email: OWNER_EMAIL, uid: OWNER_UID }])

it('advertises study goals only when enabled and disallows changing the confirmation target', () => {
  const settings = { appPublicOrigin: 'https://study.example.com', signingSecret: SECRET_A }
  const readOnly = buildSignedAgentCard(settings).card
  expect(readOnly.capabilities.extensions).toBeUndefined()
  expect(readOnly.skills.map(skill => skill.id)).toEqual(['study_summary'])
  const goal = buildSignedAgentCard({ ...settings, studyTrackGoals: true })
  expect(goal.card.capabilities.extensions?.map(extension => extension.uri)).toEqual([A2A_EXTENSION_STUDY_TRACK, A2A_EXTENSION_HITL_FORM])
  expect(goal.card.skills.map(skill => skill.id)).toContain(A2A_STUDY_TRACK_SKILL)
  expect(StudyTrackGoalConfirmSchema.safeParse({ editedFields: { dailyGoalMinutes: 40 } }).success).toBe(true)
  expect(StudyTrackGoalConfirmSchema.safeParse({ editedFields: { id: 'other-track' } }).success).toBe(false)
})

describe('server/utils/a2a-auth & Agent Card', () => {
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
        { issuer: 'team-management', secret: SECRET_A },
        { issuer: 'roza-mobile', secret: SECRET_B },
      ]),
    })
    expect(multi).toHaveLength(2)
  })

  it('verifies app-only read token for Agent Card and user read token mapped to existing UID', () => {
    const now = 1_700_000_000
    const appToken = signHmacToken(
      {
        iss: 'team-management',
        aud: A2A_AUDIENCE,
        scopes: ['read'],
        iat: now - 5,
        exp: now + 60,
        jti: 'a2a-card-1',
      },
      SECRET_A,
    )

    const appCtx = verifyA2aAuthorization({
      authorizationHeader: `Bearer ${appToken}`,
      settings: {
        a2aEnabled: true,
        a2aSharedSecret: SECRET_A,
        a2aAllowedIssuer: 'team-management',
        a2aCallersJson: '',
        ssoSharedSecret: SSO_SECRET,
      },
      requiredScope: 'read',
      requireUser: false,
      nowEpochSeconds: now,
    })
    expect(appCtx.uid).toBeNull()
    expect(appCtx.scopes).toEqual(['read'])

    const userToken = signHmacToken(
      {
        iss: 'team-management',
        aud: A2A_AUDIENCE,
        email: OWNER_EMAIL,
        scopes: ['read'],
        iat: now - 5,
        exp: now + 60,
        jti: 'a2a-read-1',
      },
      SECRET_A,
    )

    const userCtx = verifyA2aAuthorization({
      authorizationHeader: `Bearer ${userToken}`,
      settings: {
        a2aEnabled: true,
        a2aSharedSecret: SECRET_A,
        a2aAllowedIssuer: 'team-management',
        a2aCallersJson: '',
        hubAccountMappingsJson: MAPPINGS_JSON,
        ssoSharedSecret: SSO_SECRET,
      },
      requiredScope: 'read',
      requireUser: true,
      nowEpochSeconds: now,
    })
    expect(userCtx.uid).toBe(OWNER_UID)
    expect(userCtx.callerIssuer).toBe('team-management')
  })

  it('rejects write operations with read-only token and when a2aWriteEnabled is false', () => {
    const now = 1_700_000_000
    const readOnlyToken = signHmacToken(
      {
        iss: 'team-management',
        aud: A2A_AUDIENCE,
        email: OWNER_EMAIL,
        scopes: ['read'],
        iat: now - 5,
        exp: now + 60,
      },
      SECRET_A,
    )

    // Read-only token must be rejected for write operations (legacy RPC / REST draft, commit, cancel)
    expect(() =>
      verifyA2aAuthorization({
        authorizationHeader: `Bearer ${readOnlyToken}`,
        settings: {
          a2aEnabled: true,
          a2aWriteEnabled: true,
          a2aSharedSecret: SECRET_A,
          a2aAllowedIssuer: 'team-management',
          a2aCallersJson: '',
          hubAccountMappingsJson: MAPPINGS_JSON,
          ssoSharedSecret: SSO_SECRET,
        },
        requiredScope: 'write',
        requireUser: true,
        nowEpochSeconds: now,
      }),
    ).toThrowError(/lacks required 'write' scope/i)

    const writeToken = signHmacToken(
      {
        iss: 'team-management',
        aud: A2A_AUDIENCE,
        email: OWNER_EMAIL,
        scopes: ['read', 'write'],
        iat: now - 5,
        exp: now + 60,
      },
      SECRET_A,
    )

    // Even a write-scoped token must be rejected while a2aWriteEnabled is false
    expect(() =>
      verifyA2aAuthorization({
        authorizationHeader: `Bearer ${writeToken}`,
        settings: {
          a2aEnabled: true,
          a2aWriteEnabled: false,
          a2aSharedSecret: SECRET_A,
          a2aAllowedIssuer: 'team-management',
          a2aCallersJson: '',
          hubAccountMappingsJson: MAPPINGS_JSON,
          ssoSharedSecret: SSO_SECRET,
        },
        requiredScope: 'write',
        requireUser: true,
        nowEpochSeconds: now,
      }),
    ).toThrowError(/write operations are disabled/i)
  })

  it('rejects disabled A2A, unmapped accounts, and reused SSO secret', () => {
    const now = 1_700_000_000
    const token = signHmacToken(
      {
        iss: 'team-management',
        aud: A2A_AUDIENCE,
        email: 'unmapped@example.com',
        scopes: ['read'],
        iat: now - 5,
        exp: now + 60,
      },
      SECRET_A,
    )

    expect(() =>
      verifyA2aAuthorization({
        authorizationHeader: `Bearer ${token}`,
        settings: {
          a2aEnabled: false,
          a2aSharedSecret: SECRET_A,
          a2aAllowedIssuer: 'team-management',
          a2aCallersJson: '',
          hubAccountMappingsJson: MAPPINGS_JSON,
        },
        nowEpochSeconds: now,
      }),
    ).toThrowError(/disabled/i)

    expect(() =>
      verifyA2aAuthorization({
        authorizationHeader: `Bearer ${token}`,
        settings: {
          a2aEnabled: true,
          a2aSharedSecret: SECRET_A,
          a2aAllowedIssuer: 'team-management',
          a2aCallersJson: '',
          hubAccountMappingsJson: MAPPINGS_JSON,
          ssoSharedSecret: SSO_SECRET,
        },
        nowEpochSeconds: now,
      }),
    ).toThrowError(/not mapped/i)

    expect(() =>
      verifyA2aAuthorization({
        authorizationHeader: `Bearer ${token}`,
        settings: {
          a2aEnabled: true,
          a2aSharedSecret: SECRET_A,
          a2aAllowedIssuer: 'team-management',
          a2aCallersJson: '',
          hubAccountMappingsJson: MAPPINGS_JSON,
          ssoSharedSecret: SECRET_A,
        },
        nowEpochSeconds: now,
      }),
    ).toThrowError(/must be distinct/i)
  })

  it('builds a signed Agent Card with absolute HTTPS JSON-RPC 1.0 interface and streaming: false', () => {
    const { card, rawBody, signature } = buildSignedAgentCard({
      appPublicOrigin: 'https://mirai-study.example.com',
      signingSecret: SECRET_A,
    })

    expect(card.protocolVersion).toBe('1.0')
    expect(card.capabilities.streaming).toBe(false)
    expect(card.supportedInterfaces).toEqual([
      {
        url: 'https://mirai-study.example.com/api/a2a/v1',
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      },
    ])
    expect(card.skills.some((s) => s.id === 'study_summary')).toBe(true)
    expect(verifyAgentSignature(rawBody, signature, SECRET_A)).toBe(true)
    expect(verifyAgentSignature(`${rawBody} `, signature, SECRET_A)).toBe(false)
  })

  it('formats study summary text and SendMessage response with required contextId', () => {
    const snapshot = {
      tracks: [],
      selectedTrack: null,
      simulation: {
        status: 'needs_setup' as const,
        trackId: null,
        missing: ['study_track'],
        message: '学習トラックが未登録です。',
      },
      recentSessions: [],
      recentExamLogs: [],
      dueReviewCount: 0,
      activeReviewCount: 0,
    }
    const text = formatStudySummaryText(snapshot)
    expect(text).toContain('MiraiStudy 学習サマリー')
    expect(text).toContain('学習トラックが未登録です。')

    const response = buildSendMessageSummaryResponse('req-1', snapshot)
    expect(response.jsonrpc).toBe('2.0')
    expect(response.id).toBe('req-1')
    expect(response.result.message.role).toBe('ROLE_AGENT')
    expect(response.result.message.messageId).toMatch(/^[a-zA-Z0-9_-]{1,128}$/)
    expect(response.result.message.contextId).toMatch(/^[a-zA-Z0-9_-]{1,128}$/)
    expect(response.result.message.parts).toHaveLength(2)
  })
})
