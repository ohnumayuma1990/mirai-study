import { describe, expect, it } from 'vitest'
import {
  A2A_AUDIENCE,
  A2A_EXTENSION_HITL_FORM,
  A2A_EXTENSION_QUICKSHEET,
  A2A_QUICKSHEET_SKILL,
  A2aQuickSheetSnapshotSchema,
} from '../shared/schemas/a2a'
import { A2A_EXTENSION_STUDY_TRACK, A2A_STUDY_TRACK_SKILL, StudyTrackGoalConfirmSchema } from '../shared/schemas/study-track-goal'
import { signHmacToken, verifyAgentSignature } from '../server/utils/signed-token'
import { parseA2aCallers, verifyA2aAuthorization } from '../server/utils/a2a-auth'
import { buildSignedAgentCard } from '../server/routes/.well-known/agent-card.json.get'
import {
  buildQuickSheetSnapshot,
  buildSendMessageQuickSheetResponse,
  buildSendMessageSummaryResponse,
  formatStudySummaryText,
} from '../server/api/a2a/v1.post'

const SECRET_A = 'a2a-caller-secret-alpha-0123456789abcdef'
const SECRET_B = 'a2a-caller-secret-beta--0123456789abcdef'
const SSO_SECRET = 'sso-independent-secret--0123456789abcdef'
const OWNER_EMAIL = 'owner@example.com'
const OWNER_UID = 'uid-study-owner-99'
const MAPPINGS_JSON = JSON.stringify([{ email: OWNER_EMAIL, uid: OWNER_UID }])

it('advertises study goals only when enabled and disallows changing the confirmation target', () => {
  const settings = { appPublicOrigin: 'https://study.example.com', signingSecret: SECRET_A }
  const readOnly = buildSignedAgentCard(settings).card
  expect(readOnly.capabilities.extensions?.map(e => e.uri)).toEqual([A2A_EXTENSION_QUICKSHEET])
  expect(readOnly.skills.map(skill => skill.id)).toEqual(['study_summary', A2A_QUICKSHEET_SKILL])
  const goal = buildSignedAgentCard({ ...settings, studyTrackGoals: true })
  expect(goal.card.capabilities.extensions?.map(extension => extension.uri)).toEqual([A2A_EXTENSION_QUICKSHEET, A2A_EXTENSION_STUDY_TRACK, A2A_EXTENSION_HITL_FORM])
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

  it('builds valid QuickSheet snapshot and SendMessage response in both ready and empty states', () => {
    const emptyData = {
      tracks: [],
      selectedTrack: null,
      simulation: {
        status: 'needs_setup' as const,
        trackId: null,
        missing: ['study_track'],
        message: '学習トラックがまだ登録されていません。',
      },
      sessions: [],
      examLogs: [],
      reviews: [],
      dueReviewCount: 0,
      devLogs: [],
    }

    const emptySnapshot = buildQuickSheetSnapshot(emptyData)
    expect(() => A2aQuickSheetSnapshotSchema.parse(emptySnapshot)).not.toThrow()
    expect(emptySnapshot.tabs).toHaveLength(4)
    expect(emptySnapshot.tabs[0]?.blocks[0]?.kind).toBe('notice')

    const track = {
      id: 'track-1',
      title: '基本情報技術者試験',
      category: 'certification' as const,
      targetDate: '2026-12-31',
      targetScorePct: 85,
      passingScorePct: 60,
      targetTotalHours: 150,
      dailyGoalMinutes: 60,
      isDefault: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const readyData: import('../server/domain/miraistudy-service').StudyDetailSnapshotData = {
      tracks: [track],
      selectedTrack: track,
      simulation: {
        status: 'ready',
        trackId: 'track-1',
        trackTitle: '基本情報技術者試験',
        asOfDate: '2026-11-24',
        targetDate: '2026-12-31',
        daysRemaining: 37,
        passingScorePct: 60,
        targetScorePct: 85,
        targetTotalHours: 150,
        cumulativeStudyHours: 45.5,
        currentEstimatedScorePct: 78.5,
        observedDailyMinutesAvg: 65,
        effectiveDailyGoalMinutes: 60,
        dueReviewCount: 1,
        scenarios: {
          observed_trend: {
            scenario: 'observed_trend',
            label: '実績ペース',
            dailyMinutes: 65,
            projectedScoreAtTargetDate: 88.0,
            projectedHoursAtTargetDate: 160,
            willPass: true,
            estimatedPassDate: '2026-12-10',
          },
          target_pace: {
            scenario: 'target_pace',
            label: '目標ペース',
            dailyMinutes: 60,
            projectedScoreAtTargetDate: 85.0,
            projectedHoursAtTargetDate: 150,
            willPass: true,
            estimatedPassDate: '2026-12-15',
          },
          intensive_pace: {
            scenario: 'intensive_pace',
            label: '集中ペース',
            dailyMinutes: 90,
            projectedScoreAtTargetDate: 92.0,
            projectedHoursAtTargetDate: 180,
            willPass: true,
            estimatedPassDate: '2026-12-01',
          },
        },
        retentionAlert: {
          overdueReviewCount: 0,
          retentionPenaltyPct: 0,
          recommendedReviewsToday: 0,
          severity: 'none',
          message: '',
        },
        points: [],
      },
      sessions: [
        {
          id: 's-1',
          trackId: 'track-1',
          studiedDate: '2026-11-20',
          durationMinutes: 90,
          materialOrTopic: 'アルゴリズムとデータ構造',
          category: 'practice',
          focusLevel: 4,
          memo: '二分探索木の復習',
          createdAt: '2026-11-20T10:00:00.000Z',
        },
      ],
      examLogs: [
        {
          id: 'e-1',
          trackId: 'track-1',
          takenDate: '2026-11-21',
          examName: '公開模試 第1回',
          scorePct: 82.5,
          correctCount: 66,
          totalQuestions: 80,
          weakTopics: ['ネットワーク'],
          createdAt: '2026-11-21T15:00:00.000Z',
        },
      ],
      reviews: [
        {
          id: 'r-1',
          trackId: 'track-1',
          topic: 'TCP/IP 4階層モデル',
          questionOrPrompt: '4階層の名称は？',
          answerOrNote: 'ネットワークインターフェース・インターネット・トランスポート・アプリケーション',
          stage: 2,
          nextReviewDate: '2026-11-20',
          lastReviewedAt: null,
          status: 'active',
          createdAt: '2026-11-10T00:00:00.000Z',
        },
      ],
      dueReviewCount: 1,
      devLogs: [
        {
          id: 'd-1',
          trackId: 'track-1',
          loggedDate: '2026-11-22',
          featureSummary: 'A2A Quicksheet Snapshot実装',
          handsOnMinutes: 120,
          completedTasks: 3,
          tags: ['a2a'],
          createdAt: '2026-11-22T18:00:00.000Z',
        },
      ],
    }

    const readySnapshot = buildQuickSheetSnapshot(readyData, '2026-11-24T00:00:00.000Z')
    expect(() => A2aQuickSheetSnapshotSchema.parse(readySnapshot)).not.toThrow()
    expect(readySnapshot.tabs.map((t) => t.label)).toEqual([
      '未来予測',
      '学習セッション',
      '演習・模試',
      '復習キュー・開発進捗',
    ])

    const rpcResponse = buildSendMessageQuickSheetResponse('rpc-99', readyData, '2026-11-24T00:00:00.000Z')
    expect(rpcResponse.jsonrpc).toBe('2.0')
    expect(rpcResponse.id).toBe('rpc-99')
    expect(rpcResponse.result.message.parts).toHaveLength(2)
    const dataPart = rpcResponse.result.message.parts[1]
    expect(dataPart && 'data' in dataPart && Boolean(dataPart.data)).toBe(true)
    if (dataPart && 'data' in dataPart && dataPart.data) {
      expect(dataPart.data.extension).toBe(A2A_EXTENSION_QUICKSHEET)
      expect(dataPart.data.payload.title).toContain('基本情報技術者試験')
    }
  })
})
