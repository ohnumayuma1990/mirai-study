import { randomUUID } from 'node:crypto'
import { createError, defineEventHandler } from 'h3'
import {
  A2A_AGENT_ID,
  A2A_EXTENSION_HITL_FORM,
  A2A_EXTENSION_QUICKSHEET,
  A2A_EXTENSION_UI_CARDS,
  A2aMessagePartSchema,
  A2aQuickSheetTabSchema,
  type A2aRecordKind,
} from '../../../shared/schemas/a2a'
import { VisionIngestTypeSchema, type VisionIngestType } from '../../../shared/schemas/vision'
import { todayIsoUtc } from '../../../shared/domain/simulation'
import { requireA2aCaller } from '../../utils/a2a-auth'
import { readAndValidateA2aBody } from '../../utils/a2a-body'
import { getAdminStorageBucket } from '../../utils/firebase-admin'
import { validateImageBuffer } from '../../utils/image-validation'
import { analyzeStudyImageWithOpenAI } from '../../utils/openai'
import { a2aRateLimiter } from '../../utils/rate-limit'
import { getClientIp } from '../../utils/request-ip'
import {
  getStudySimulationForUser,
  listDevLogs,
  listExamLogs,
  listReviewItems,
  listStudySessions,
  listStudyTracks,
} from '../../domain/miraistudy-service'
import {
  cancelA2aDraftTask,
  createA2aDraftTask,
  getA2aDraftTask,
} from '../../domain/record-task'

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

export default defineEventHandler(async (event) => {
  const caller = requireA2aCaller(event)
  const ip = getClientIp(event)
  a2aRateLimiter.assertAllowed(`a2a:uid:${caller.uid}`)
  a2aRateLimiter.assertAllowed(`a2a:ip:${ip}`)

  const rpc = await readAndValidateA2aBody(event)
  const uid = caller.uid

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

  if (rpc.method === 'tasks/cancel') {
    const taskId = typeof rpc.params.taskId === 'string' ? rpc.params.taskId.trim() : ''
    if (!taskId) {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request: taskId is required.' })
    }
    const task = await cancelA2aDraftTask(uid, taskId)
    return { jsonrpc: '2.0', id: rpc.id, result: { task } }
  }

  // method === 'message/send'
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
