import { randomUUID } from 'node:crypto'
import { createError, defineEventHandler, getHeader, setResponseHeader } from 'h3'
import {
  A2A_AGENT_ID,
  A2A_EXTENSION_HITL_FORM,
  A2A_EXTENSION_QUICKSHEET,
  A2A_EXTENSION_UI_CARDS,
  A2A_QUICKSHEET_SKILL,
  A2aMessagePartSchema,
  A2aQuickSheetSnapshotSchema,
  A2aQuickSheetTabSchema,
  A2aSendMessageParamsSchema,
  type A2aRecordKind,
  type A2aQuickSheetBlock,
  type A2aQuickSheetSnapshot,
} from '../../../shared/schemas/a2a'
import {
  A2A_EXTENSION_STUDY_TRACK,
  StudyTrackGoalConfirmSchema,
  StudyTrackGoalTaskIdSchema,
  StudyTrackGoalTurnSchema,
} from '../../../shared/schemas/study-track-goal'
import { VisionIngestTypeSchema, type VisionIngestType } from '../../../shared/schemas/vision'
import { todayIsoUtc } from '../../../shared/domain/simulation'
import { assertA2aWriteAllowed, requireA2aCaller } from '../../utils/a2a-auth'
import { readAndValidateA2aBody } from '../../utils/a2a-body'
import { getAdminStorageBucket } from '../../utils/firebase-admin'
import { validateImageBuffer } from '../../utils/image-validation'
import { analyzeStudyImageWithOpenAI } from '../../utils/openai'
import { a2aRateLimiter } from '../../utils/rate-limit'
import { getClientIp } from '../../utils/request-ip'
import {
  getStudyDetailSnapshotDataForUser,
  getStudySimulationForUser,
  getStudySummaryForUser,
  listDevLogs,
  listExamLogs,
  listReviewItems,
  listStudySessions,
  listStudyTracks,
  type StudyDetailSnapshotData,
  type StudySummarySnapshot,
} from '../../domain/miraistudy-service'
import {
  cancelA2aDraftTask,
  createA2aDraftTask,
  getA2aDraftTask,
} from '../../domain/record-task'
import { prepareStudyTrackGoal, resolveStudyTrackGoal } from '../../domain/study-track-goal'

function inferRecordKindFromText(text: string): A2aRecordKind {
  const lower = text.toLowerCase()
  if (lower.includes('模試') || lower.includes('過去問') || lower.includes('得点') || lower.includes('exam') || lower.includes('score')) {
    return 'exam_log'
  }
  if (lower.includes('実装') || lower.includes('開発') || lower.includes('コミット') || lower.includes('dev') || lower.includes('pr')) {
    return 'dev_log'
  }
  if (lower.includes('復習') || lower.includes('暗記') || lower.includes('カード') || lower.includes('review')) {
    return 'review_item'
  }
  return 'study_session'
}

function inferIngestTypeFromText(text: string): VisionIngestType {
  const lower = text.toLowerCase()
  if (lower.includes('模試') || lower.includes('結果') || lower.includes('スコア') || lower.includes('exam')) {
    return 'exam_result_ocr'
  }
  if (lower.includes('タイマー') || lower.includes('studyplus') || lower.includes('時間')) {
    return 'study_timer_ocr'
  }
  return 'study_material_photo'
}

export function formatStudySummaryText(snapshot: StudySummarySnapshot): string {
  if (!snapshot.selectedTrack || snapshot.simulation.status === 'needs_setup') {
    const message =
      snapshot.simulation.status === 'needs_setup'
        ? snapshot.simulation.message
        : '学習トラックがまだ登録されていません。'
    return `【MiraiStudy 学習サマリー】\n${message}`
  }

  const sim = snapshot.simulation
  const lines = [
    `【MiraiStudy 学習サマリー: ${sim.trackTitle}】`,
    `・目標日: ${sim.targetDate}（残り ${sim.daysRemaining} 日）`,
    `・累計学習時間: ${sim.cumulativeStudyHours.toFixed(1)}h / 目標 ${sim.targetTotalHours}h（直近平均 ${Math.round(sim.observedDailyMinutesAvg)}分/日）`,
    `・現在の推定得点率: ${sim.currentEstimatedScorePct.toFixed(1)}%（合格ライン ${sim.passingScorePct}% / 目標 ${sim.targetScorePct}%）`,
    `・3シナリオ予測（目標日時点）: 実績ペース ${sim.scenarios.observed_trend.projectedScoreAtTargetDate.toFixed(1)}% / 目標ペース ${sim.scenarios.target_pace.projectedScoreAtTargetDate.toFixed(1)}% / 集中ペース ${sim.scenarios.intensive_pace.projectedScoreAtTargetDate.toFixed(1)}%`,
    `・要復習カード: ${snapshot.dueReviewCount}件（有効カード ${snapshot.activeReviewCount}件）`,
  ]

  if (snapshot.recentSessions.length > 0) {
    const latest = snapshot.recentSessions[0]!
    lines.push(`・直近の学習記録: ${latest.studiedDate} ${latest.materialOrTopic}（${latest.durationMinutes}分）`)
  }

  return lines.join('\n')
}

export function buildSendMessageSummaryResponse(
  rpcId: string | number,
  snapshot: StudySummarySnapshot,
) {
  const summaryText = formatStudySummaryText(snapshot)
  return {
    jsonrpc: '2.0' as const,
    id: rpcId,
    result: {
      message: {
        role: 'ROLE_AGENT' as const,
        messageId: randomUUID(),
        contextId: randomUUID(),
        parts: [
          { text: summaryText },
          {
            data: {
              agentId: A2A_AGENT_ID,
              skill: 'study_summary',
              tracksCount: snapshot.tracks.length,
              selectedTrack: snapshot.selectedTrack,
              simulation: snapshot.simulation,
              recentSessions: snapshot.recentSessions,
              recentExamLogs: snapshot.recentExamLogs,
              dueReviewCount: snapshot.dueReviewCount,
              activeReviewCount: snapshot.activeReviewCount,
            },
          },
        ],
      },
    },
  }
}

export function boundText(raw: string, fallback: string, maxLen = 200): string {
  const trimmed = raw.trim()
  if (!trimmed) return fallback
  if (trimmed.length <= maxLen) return trimmed
  return trimmed.slice(0, maxLen)
}

export function buildQuickSheetSnapshot(
  data: StudyDetailSnapshotData,
  nowIso = new Date().toISOString(),
): A2aQuickSheetSnapshot {
  const title = data.selectedTrack
    ? boundText(`MiraiStudy: ${data.selectedTrack.title}`, 'MiraiStudy 学習詳細', 120)
    : 'MiraiStudy 学習詳細'
  const subtitle = data.selectedTrack
    ? boundText(`目標日 ${data.selectedTrack.targetDate}・目標 ${data.selectedTrack.targetScorePct}%`, '学習状況', 120)
    : '学習トラック未登録'

  const sim = data.simulation

  const simulationBlocks: A2aQuickSheetBlock[] = sim.status === 'ready'
    ? [
        {
          kind: 'kpi_grid',
          items: [
            {
              label: '推定得点率',
              value: `${sim.currentEstimatedScorePct.toFixed(1)}%`,
              sub: `合格 ${sim.passingScorePct}% / 目標 ${sim.targetScorePct}%`,
              tone: 'indigo',
            },
            {
              label: '累計学習時間',
              value: `${sim.cumulativeStudyHours.toFixed(1)}h`,
              sub: `目標 ${sim.targetTotalHours}h`,
              tone: 'neutral',
            },
            {
              label: '目標日まで',
              value: `${sim.daysRemaining}日`,
              sub: `目標日 ${sim.targetDate}`,
              tone: sim.daysRemaining <= 14 ? 'amber' : 'neutral',
            },
          ],
        },
        {
          kind: 'list',
          items: [
            {
              label: '実績ペース予測',
              value: `${sim.scenarios.observed_trend.projectedScoreAtTargetDate.toFixed(1)}%`,
              sub: `直近平均 ${Math.round(sim.observedDailyMinutesAvg)}分/日`,
            },
            {
              label: '目標ペース予測',
              value: `${sim.scenarios.target_pace.projectedScoreAtTargetDate.toFixed(1)}%`,
              sub: `目標 ${Math.round(sim.scenarios.target_pace.dailyMinutes)}分/日`,
            },
            {
              label: '集中ペース予測',
              value: `${sim.scenarios.intensive_pace.projectedScoreAtTargetDate.toFixed(1)}%`,
              sub: `集中 ${Math.round(sim.scenarios.intensive_pace.dailyMinutes)}分/日`,
            },
          ],
        },
        ...(sim.retentionAlert.severity !== 'none'
          ? [
              {
                kind: 'notice' as const,
                text: boundText(sim.retentionAlert.message, '忘却アラートが発生しています。早めに復習を行いましょう。', 300),
                tone: (sim.retentionAlert.severity === 'critical' ? 'rose' : 'amber') as 'rose' | 'amber',
              },
            ]
          : []),
      ]
    : [
        {
          kind: 'notice',
          text: boundText(sim.message, '学習トラックがまだ登録されていません。'),
          tone: 'neutral',
        },
      ]

  const studySessionsBlocks: A2aQuickSheetBlock[] = data.sessions.length > 0
    ? [
        {
          kind: 'kpi_grid',
          items: [
            {
              label: '記録件数',
              value: `${data.sessions.length}件`,
              tone: 'neutral',
            },
            {
              label: '合計学習時間',
              value: `${(data.sessions.reduce((acc, s) => acc + s.durationMinutes, 0) / 60).toFixed(1)}h`,
              tone: 'indigo',
            },
            {
              label: '平均集中度',
              value: (data.sessions.reduce((acc, s) => acc + s.focusLevel, 0) / data.sessions.length).toFixed(1),
              sub: '/5',
              tone: 'emerald',
            },
          ],
        },
        {
          kind: 'mini_bars',
          items: data.sessions.slice(0, 10).map((s) => ({
            label: boundText(`${s.studiedDate.slice(5)} ${s.materialOrTopic}`, s.studiedDate, 40),
            value: s.durationMinutes,
            unit: '分',
          })),
        },
        {
          kind: 'list',
          items: data.sessions.slice(0, 15).map((s) => ({
            label: boundText(s.materialOrTopic, '学習セッション', 100),
            value: `${s.durationMinutes}分`,
            sub: boundText(`集中度 ${s.focusLevel}/5${s.memo ? `・${s.memo}` : ''}`, `集中度 ${s.focusLevel}/5`, 120),
          })),
        },
      ]
    : [
        {
          kind: 'notice',
          text: '学習セッションの記録はまだありません。',
          tone: 'neutral',
        },
      ]

  const examLogsBlocks: A2aQuickSheetBlock[] = data.examLogs.length > 0
    ? [
        {
          kind: 'kpi_grid',
          items: [
            {
              label: '演習記録件数',
              value: `${data.examLogs.length}件`,
              tone: 'neutral',
            },
            {
              label: '最新得点率',
              value: `${data.examLogs[0]?.scorePct.toFixed(1) ?? 0}%`,
              tone: 'indigo',
            },
            {
              label: '平均得点率',
              value: `${(data.examLogs.reduce((acc, l) => acc + l.scorePct, 0) / data.examLogs.length).toFixed(1)}%`,
              tone: 'emerald',
            },
          ],
        },
        {
          kind: 'mini_bars',
          items: data.examLogs.slice(0, 10).map((log) => ({
            label: boundText(`${log.takenDate.slice(5)} ${log.examName}`, log.takenDate, 40),
            value: Number(log.scorePct.toFixed(1)),
            unit: '%',
          })),
        },
        {
          kind: 'list',
          items: data.examLogs.slice(0, 15).map((log) => ({
            label: boundText(`${log.takenDate} ${log.examName}`, '演習・模試', 100),
            value: `${log.scorePct.toFixed(1)}%`,
            sub: boundText(
              [
                log.correctCount !== undefined && log.totalQuestions !== undefined ? `正答 ${log.correctCount}/${log.totalQuestions}` : '',
                log.weakTopics.length > 0 ? `弱点: ${log.weakTopics.join('・')}` : '',
              ].filter(Boolean).join('・'),
              '演習記録',
              120,
            ),
          })),
        },
      ]
    : [
        {
          kind: 'notice',
          text: '演習・模試の記録はまだありません。',
          tone: 'neutral',
        },
      ]

  const today = todayIsoUtc()
  const totalHandsOnMinutes = data.devLogs.reduce((acc, d) => acc + d.handsOnMinutes, 0)

  const reviewsAndDevBlocks: A2aQuickSheetBlock[] = data.reviews.length > 0 || data.devLogs.length > 0
    ? [
        {
          kind: 'kpi_grid',
          items: [
            {
              label: '要復習カード',
              value: `${data.dueReviewCount}件`,
              sub: `有効 ${data.reviews.length}件`,
              tone: data.dueReviewCount > 0 ? 'amber' : 'emerald',
            },
            {
              label: '開発ログ',
              value: `${data.devLogs.length}件`,
              sub: `ハンズオン ${totalHandsOnMinutes}分`,
              tone: 'indigo',
            },
          ],
        },
        ...(data.reviews.length > 0
          ? [
              {
                kind: 'list' as const,
                items: data.reviews.slice(0, 10).map((r) => ({
                  label: boundText(r.topic, '復習カード', 80),
                  value: r.nextReviewDate <= today ? '要復習' : r.nextReviewDate,
                  sub: `Stage ${r.stage}`,
                })),
              },
            ]
          : []),
        ...(data.devLogs.length > 0
          ? [
              {
                kind: 'list' as const,
                items: data.devLogs.slice(0, 10).map((d) => ({
                  label: boundText(`${d.loggedDate} ${d.featureSummary}`, d.loggedDate, 100),
                  value: `${d.handsOnMinutes}分`,
                  sub: `完了タスク ${d.completedTasks}件`,
                })),
              },
            ]
          : []),
      ]
    : [
        {
          kind: 'notice',
          text: '復習カードと開発ログはまだありません。',
          tone: 'neutral',
        },
      ]

  return A2aQuickSheetSnapshotSchema.parse({
    title,
    subtitle,
    generatedAt: nowIso,
    tabs: [
      {
        id: 'simulation',
        label: '未来予測',
        externalPath: '/',
        blocks: simulationBlocks,
      },
      {
        id: 'study_sessions',
        label: '学習セッション',
        externalPath: '/logs',
        blocks: studySessionsBlocks,
      },
      {
        id: 'exam_logs',
        label: '演習・模試',
        externalPath: '/logs',
        blocks: examLogsBlocks,
      },
      {
        id: 'reviews_and_dev',
        label: '復習キュー・開発進捗',
        externalPath: '/logs',
        blocks: reviewsAndDevBlocks,
      },
    ],
  })
}

export function buildSendMessageQuickSheetResponse(
  rpcId: string | number,
  data: StudyDetailSnapshotData,
  nowIso?: string,
) {
  const snapshot = buildQuickSheetSnapshot(data, nowIso)
  return {
    jsonrpc: '2.0' as const,
    id: rpcId,
    result: {
      message: {
        role: 'ROLE_AGENT' as const,
        messageId: randomUUID(),
        contextId: randomUUID(),
        parts: [
          { text: `${snapshot.title}を取得しました。` },
          {
            data: {
              extension: A2A_EXTENSION_QUICKSHEET,
              payload: snapshot,
            },
          },
        ],
      },
    },
  }
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')

  const ip = getClientIp(event)
  a2aRateLimiter.assertAllowed(`a2a:ip:${ip}`)

  // Authenticate caller and verify a2aEnabled BEFORE buffering/parsing request body (up to 6MB)
  const caller = await requireA2aCaller(event, {
    requiredScope: 'read',
    requireUser: true,
  })
  const uid = caller.uid!
  a2aRateLimiter.assertAllowed(`a2a:uid:${uid}`)

  const rpc = await readAndValidateA2aBody(event)
  const studyTrackExtension = getHeader(event, 'a2a-extensions')?.split(',').some(uri => uri.trim() === A2A_EXTENSION_STUDY_TRACK)

  if (studyTrackExtension && rpc.method === 'CancelTask') {
    assertA2aWriteAllowed(caller, useRuntimeConfig().a2aStudyTrackEnabled === true)
    const taskId = StudyTrackGoalTaskIdSchema.safeParse(rpc.params.id)
    if (!taskId.success) throw createError({ statusCode: 400, statusMessage: 'Invalid study goal task ID.' })
    const task = await resolveStudyTrackGoal(uid, taskId.data, null)
    return { jsonrpc: '2.0', id: rpc.id, result: { task } }
  }

  const isWriteMethod =
    rpc.method === 'CancelTask' ||
    rpc.method === 'tasks/cancel' ||
    rpc.method === 'message/send'

  if (isWriteMethod) {
    const config = useRuntimeConfig()
    assertA2aWriteAllowed(caller, Boolean(config.a2aWriteEnabled))
  }

  // A2A v1.0 synchronous SendMessage.
  if (rpc.method === 'SendMessage') {
    const parsedParams = A2aSendMessageParamsSchema.safeParse(rpc.params)
    if (!parsedParams.success) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request: Invalid A2A SendMessage params.',
      })
    }

    const { message, metadata } = parsedParams.data
    if (studyTrackExtension || metadata?.studyTrackGoal !== undefined) {
      assertA2aWriteAllowed(caller, useRuntimeConfig().a2aStudyTrackEnabled === true && Boolean(studyTrackExtension))
      const [part] = message.parts
      if (message.taskId) {
        const taskId = StudyTrackGoalTaskIdSchema.safeParse(message.taskId)
        const confirmation = StudyTrackGoalConfirmSchema.safeParse(part && 'data' in part ? part.data : null)
        if (!taskId.success || !confirmation.success || message.parts.length !== 1) {
          throw createError({ statusCode: 400, statusMessage: 'Invalid study goal confirmation.' })
        }
        const task = await resolveStudyTrackGoal(uid, taskId.data, confirmation.data.editedFields)
        return { jsonrpc: '2.0', id: rpc.id, result: { task } }
      }
      const turn = StudyTrackGoalTurnSchema.safeParse(metadata)
      if (!turn.success || message.parts.length !== 1 || !part || !('text' in part) || !part.text.trim() || part.text.length > 1000) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid study goal message.' })
      }
      const result = await prepareStudyTrackGoal(uid, turn.data, part.text.trim())
      if (result) return { jsonrpc: '2.0', id: rpc.id, result }
    }

    const rawTrackId = parsedParams.data.metadata?.trackId
    const trackId = typeof rawTrackId === 'string' && rawTrackId.trim().length > 0
      ? rawTrackId.trim()
      : undefined

    if (metadata?.skill === A2A_QUICKSHEET_SKILL) {
      const detailData = await getStudyDetailSnapshotDataForUser(uid, { trackId })
      return buildSendMessageQuickSheetResponse(rpc.id, detailData)
    }

    const snapshot = await getStudySummaryForUser(uid, { trackId })
    return buildSendMessageSummaryResponse(rpc.id, snapshot)
  }

  if (rpc.method === 'quicksheet/get') {
    const rawTab = typeof rpc.params.tab === 'string' ? rpc.params.tab : 'simulation'
    const parsedTab = A2aQuickSheetTabSchema.safeParse(rawTab)
    const tab = parsedTab.success ? parsedTab.data : 'simulation'
    const trackId = typeof rpc.params.trackId === 'string' ? rpc.params.trackId : undefined

    const tracks = await listStudyTracks(uid)
    const activeTrackId = trackId ?? tracks.find((t) => t.isDefault)?.id ?? tracks[0]?.id

    if (tab === 'simulation') {
      const simulation = await getStudySimulationForUser(uid, { trackId: activeTrackId })
      return {
        jsonrpc: '2.0',
        id: rpc.id,
        result: {
          agentId: A2A_AGENT_ID,
          extension: A2A_EXTENSION_QUICKSHEET,
          tab,
          tracks,
          simulation,
        },
      }
    }

    if (tab === 'study_sessions') {
      const sessions = await listStudySessions(uid, { trackId: activeTrackId, limit: 30 })
      return {
        jsonrpc: '2.0',
        id: rpc.id,
        result: {
          agentId: A2A_AGENT_ID,
          extension: A2A_EXTENSION_QUICKSHEET,
          tab,
          tracks,
          sessions,
        },
      }
    }

    if (tab === 'exam_logs') {
      const logs = await listExamLogs(uid, { trackId: activeTrackId, limit: 30 })
      return {
        jsonrpc: '2.0',
        id: rpc.id,
        result: {
          agentId: A2A_AGENT_ID,
          extension: A2A_EXTENSION_QUICKSHEET,
          tab,
          tracks,
          logs,
        },
      }
    }

    const [reviews, devLogs] = await Promise.all([
      listReviewItems(uid, { trackId: activeTrackId, limit: 50 }),
      listDevLogs(uid, { trackId: activeTrackId, limit: 30 }),
    ])
    return {
      jsonrpc: '2.0',
      id: rpc.id,
      result: {
        agentId: A2A_AGENT_ID,
        extension: A2A_EXTENSION_QUICKSHEET,
        tab,
        tracks,
        reviews,
        devLogs,
      },
    }
  }

  if (rpc.method === 'tasks/get') {
    const taskId = typeof rpc.params.taskId === 'string' ? rpc.params.taskId.trim() : ''
    if (!taskId) {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request: taskId is required.' })
    }
    const task = await getA2aDraftTask(uid, taskId)
    return { jsonrpc: '2.0', id: rpc.id, result: { task } }
  }

  if (rpc.method === 'tasks/cancel' || rpc.method === 'CancelTask') {
    const rawId = rpc.method === 'CancelTask' ? rpc.params.id : rpc.params.taskId
    const taskId = typeof rawId === 'string' ? rawId.trim() : ''
    if (!taskId) {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request: taskId is required.' })
    }
    const task = await cancelA2aDraftTask(uid, taskId)
    return { jsonrpc: '2.0', id: rpc.id, result: { task } }
  }

  // Legacy method === 'message/send' (write scope + a2aWriteEnabled required)
  const rawParts = Array.isArray((rpc.params.message as Record<string, unknown> | undefined)?.parts)
    ? ((rpc.params.message as Record<string, unknown>).parts as unknown[])
    : []

  const parsedParts = rawParts
    .map((p) => A2aMessagePartSchema.safeParse(p))
    .filter((r) => r.success)
    .map((r) => r.data)

  const textSummary = parsedParts
    .filter((p): p is Extract<typeof p, { kind: 'text' }> => p.kind === 'text')
    .map((p) => p.text)
    .join('\n')
    .trim()

  const filePart = parsedParts.find((p): p is Extract<typeof p, { kind: 'file' }> => p.kind === 'file')
  const tracks = await listStudyTracks(uid)
  const defaultTrackId = tracks.find((t) => t.isDefault)?.id ?? tracks[0]?.id ?? ''
  const today = todayIsoUtc()

  if (filePart) {
    const buffer = Buffer.from(filePart.file.bytes, 'base64')
    const validatedImage = validateImageBuffer(buffer, filePart.file.mimeType)
    const explicitIngest = typeof rpc.params.ingestType === 'string'
      ? VisionIngestTypeSchema.safeParse(rpc.params.ingestType)
      : null
    const ingestType: VisionIngestType = explicitIngest?.success
      ? explicitIngest.data
      : inferIngestTypeFromText(textSummary)

    const config = useRuntimeConfig()
    const bucket = getAdminStorageBucket()

    const analysis = await analyzeStudyImageWithOpenAI({
      apiKey: String(config.openaiApiKey ?? ''),
      model: String(config.openaiModel ?? 'gpt-4.1-mini'),
      ingestType,
      imageBuffer: buffer,
      mimeType: validatedImage.mimeType,
      userNote: textSummary || undefined,
    })

    const stagingPath = `staging/${uid}/${randomUUID()}.${validatedImage.extension}`
    await bucket.file(stagingPath).save(buffer, {
      contentType: validatedImage.mimeType,
      resumable: false,
    })

    const recordKind: A2aRecordKind =
      analysis.ingestType === 'exam_result_ocr'
        ? 'exam_log'
        : analysis.ingestType === 'study_timer_ocr'
          ? 'study_session'
          : 'review_item'

    const draft: Record<string, unknown> =
      analysis.ingestType === 'exam_result_ocr'
        ? {
            trackId: defaultTrackId,
            takenDate: analysis.takenDate ?? today,
            examName: analysis.examName,
            scorePct: analysis.scorePct,
            correctCount: analysis.correctCount ?? undefined,
            totalQuestions: analysis.totalQuestions ?? undefined,
            domainArea: analysis.domainArea ?? undefined,
            weakTopics: analysis.weakTopics,
            memo: analysis.summary,
          }
        : analysis.ingestType === 'study_timer_ocr'
          ? {
              trackId: defaultTrackId,
              studiedDate: analysis.studiedDate ?? today,
              durationMinutes: analysis.durationMinutes,
              materialOrTopic: analysis.materialOrTopic,
              category: analysis.category,
              focusLevel: analysis.focusLevel,
              memo: analysis.summary,
            }
          : {
              trackId: defaultTrackId,
              topic: analysis.reviewCards[0]?.topic ?? analysis.materialOrTopic,
              questionOrPrompt: analysis.reviewCards[0]?.questionOrPrompt ?? `${analysis.materialOrTopic}の要点は？`,
              answerOrNote: analysis.reviewCards[0]?.answerOrNote ?? analysis.keySummary,
            }

    const task = await createA2aDraftTask({
      uid,
      recordKind,
      draft,
      stagingImagePath: stagingPath,
    })

    return {
      jsonrpc: '2.0',
      id: rpc.id,
      result: {
        agentId: A2A_AGENT_ID,
        extensions: [A2A_EXTENSION_HITL_FORM, A2A_EXTENSION_UI_CARDS],
        status: task.status,
        taskId: task.taskId,
        recordKind: task.recordKind,
        draft: task.draft,
        analysis,
      },
    }
  }

  // Text-only HITL draft creation
  const recordKind = inferRecordKindFromText(textSummary)
  const draft: Record<string, unknown> =
    recordKind === 'exam_log'
      ? {
          trackId: defaultTrackId,
          takenDate: today,
          examName: textSummary.slice(0, 80) || '演習ログ',
          scorePct: 70,
          weakTopics: [],
        }
      : recordKind === 'dev_log'
        ? {
            trackId: defaultTrackId,
            loggedDate: today,
            featureSummary: textSummary.slice(0, 120) || 'ハンズオン進捗',
            completedTasks: 1,
            handsOnMinutes: 60,
            tags: [],
          }
        : recordKind === 'review_item'
          ? {
              trackId: defaultTrackId,
              topic: textSummary.slice(0, 80) || '重要論点',
              questionOrPrompt: textSummary.slice(0, 200) || '確認ポイントを入力してください',
              answerOrNote: '要点メモを入力してください',
            }
          : {
              trackId: defaultTrackId,
              studiedDate: today,
              durationMinutes: 60,
              materialOrTopic: textSummary.slice(0, 100) || '学習セッション',
              category: 'practice',
              focusLevel: 4,
            }

  const task = await createA2aDraftTask({
    uid,
    recordKind,
    draft,
  })

  return {
    jsonrpc: '2.0',
    id: rpc.id,
    result: {
      agentId: A2A_AGENT_ID,
      extensions: [A2A_EXTENSION_HITL_FORM, A2A_EXTENSION_UI_CARDS],
      status: task.status,
      taskId: task.taskId,
      recordKind: task.recordKind,
      draft: task.draft,
    },
  }
})
