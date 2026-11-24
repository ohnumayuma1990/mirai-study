import { defineEventHandler, setResponseHeader } from 'h3'
import {
  A2A_AGENT_ID,
  A2A_EXTENSION_HITL_FORM,
  A2A_EXTENSION_QUICKSHEET,
  A2A_QUICKSHEET_SKILL,
  A2A_PROTOCOL_VERSION,
  A2aAgentCardSchema,
  type A2aAgentCard,
} from '../../../shared/schemas/a2a'
import { A2A_EXTENSION_STUDY_TRACK, A2A_STUDY_TRACK_SKILL } from '../../../shared/schemas/study-track-goal'
import { requireA2aCaller } from '../../utils/a2a-auth'
import { parseBooleanRuntimeFlag } from '../../utils/runtime-config'
import { a2aRateLimiter } from '../../utils/rate-limit'
import { getClientIp } from '../../utils/request-ip'
import { signAgentPayload } from '../../utils/signed-token'
import { validateStrictOrigin } from '../../utils/sso'

export function buildSignedAgentCard(params: {
  appPublicOrigin: string
  signingSecret: string
  studyTrackGoals?: boolean
}): { card: A2aAgentCard; rawBody: string; signature: string } {
  const origin = validateStrictOrigin(params.appPublicOrigin, 'NUXT_APP_PUBLIC_ORIGIN')

  const card: A2aAgentCard = A2aAgentCardSchema.parse({
    id: A2A_AGENT_ID,
    name: 'MiraiStudy',
    description: '資格試験・技術習得の学習記録、3シナリオ未来予測、忘却曲線復習キューの学習サマリーを提供するAIエージェント',
    protocolVersion: A2A_PROTOCOL_VERSION,
    supportedInterfaces: [
      {
        url: `${origin}/api/a2a/v1`,
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      },
    ],
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: [
        { uri: A2A_EXTENSION_QUICKSHEET },
        ...(params.studyTrackGoals ? [{ uri: A2A_EXTENSION_STUDY_TRACK }, { uri: A2A_EXTENSION_HITL_FORM }] : []),
      ],
    },
    skills: [
      {
        id: 'study_summary',
        name: '学習サマリー照会',
        description: '学習トラック・直近の学習実績・3シナリオ未来予測・要復習件数のサマリーを同期で取得',
      },
      {
        id: A2A_QUICKSHEET_SKILL,
        name: '学習詳細スナップショット取得',
        description: '未来予測・学習セッション・演習/模試・復習キュー/開発進捗の4タブ詳細を読み取り専用で取得',
      },
      ...(params.studyTrackGoals ? [{
        id: A2A_STUDY_TRACK_SKILL,
        name: '学習目標の新規作成・変更',
        description: '対話で学習トラックの目標を作成し、本人の確認後に保存',
      }] : []),
    ],
  })

  const rawBody = JSON.stringify(card)
  const signature = signAgentPayload(rawBody, params.signingSecret)
  return { card, rawBody, signature }
}

export default defineEventHandler(async (event) => {
  const ip = getClientIp(event)
  a2aRateLimiter.assertAllowed(`a2a:ip:${ip}`)

  const caller = await requireA2aCaller(event, {
    requiredScope: 'read',
    requireUser: false,
  })

  const config = useRuntimeConfig()
  const { rawBody, signature } = buildSignedAgentCard({
    appPublicOrigin: String(config.appPublicOrigin ?? ''),
    signingSecret: caller.callerSecret,
    studyTrackGoals: parseBooleanRuntimeFlag(config.a2aStudyTrackEnabled, false) && Boolean(String(config.openaiApiKey ?? '').trim()),
  })

  setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'x-agent-card-signature', signature)

  return rawBody
})
