import { createError, defineEventHandler } from 'h3'
import {
  A2A_AGENT_ID,
  A2A_EXTENSION_HITL_FORM,
  A2A_EXTENSION_QUICKSHEET,
  A2A_EXTENSION_UI_CARDS,
  A2A_PROTOCOL_VERSION,
} from '../../../shared/schemas/a2a'

export default defineEventHandler(() => {
  const config = useRuntimeConfig()
  if (!config.a2aEnabled || !config.a2aAgentCardPublic) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
    })
  }

  return {
    id: A2A_AGENT_ID,
    name: 'MiraiStudy',
    description: '資格試験・技術習得の学習記録、3シナリオ未来予測、忘却曲線復習キューを管理するAIエージェント',
    protocolVersion: A2A_PROTOCOL_VERSION,
    url: '/api/a2a/v1',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: [
        { uri: A2A_EXTENSION_QUICKSHEET, required: false },
        { uri: A2A_EXTENSION_UI_CARDS, required: false },
        { uri: A2A_EXTENSION_HITL_FORM, required: false },
      ],
    },
    skills: [
      {
        id: 'study_simulation',
        name: '3シナリオ学習未来予測',
        description: '実績トレンド・目標ペース・集中ペースの3シナリオで試験日までの予測得点率と到達日を算出',
      },
      {
        id: 'study_logging_hitl',
        name: '学習記録・模試・復習カード登録 (HITL)',
        description: 'チャットや画像から学習セッション・模試スコア・開発進捗・復習カードのドラフトを作成',
      },
    ],
  }
})
