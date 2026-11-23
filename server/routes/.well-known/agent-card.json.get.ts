import { defineEventHandler, setResponseHeader } from 'h3'
import {
  A2A_AGENT_ID,
  A2A_PROTOCOL_VERSION,
  A2aAgentCardSchema,
  type A2aAgentCard,
} from '../../../shared/schemas/a2a'
import { requireA2aCaller } from '../../utils/a2a-auth'
import { a2aRateLimiter } from '../../utils/rate-limit'
import { getClientIp } from '../../utils/request-ip'
import { signAgentPayload } from '../../utils/signed-token'
import { validateStrictOrigin } from '../../utils/sso'

export function buildSignedAgentCard(params: {
  appPublicOrigin: string
  signingSecret: string
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
    },
    skills: [
      {
        id: 'study_summary',
        name: '学習サマリー照会',
        description: '学習トラック・直近の学習実績・3シナリオ未来予測・要復習件数のサマリーを同期で取得',
      },
    ],
  })

  const rawBody = JSON.stringify(card)
  const signature = signAgentPayload(rawBody, params.signingSecret)
  return { card, rawBody, signature }
}

export default defineEventHandler((event) => {
  const ip = getClientIp(event)
  a2aRateLimiter.assertAllowed(`a2a:ip:${ip}`)

  const caller = requireA2aCaller(event, {
    requiredScope: 'read',
    requireUser: false,
  })

  const config = useRuntimeConfig()
  const { rawBody, signature } = buildSignedAgentCard({
    appPublicOrigin: String(config.appPublicOrigin ?? ''),
    signingSecret: caller.callerSecret,
  })

  setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'x-agent-card-signature', signature)

  return rawBody
})
