import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import { z } from 'zod'
import { A2A_AGENT_ID, A2A_EXTENSION_HITL_FORM } from '../../shared/schemas/a2a'
import {
  A2A_EXTENSION_STUDY_TRACK,
  type StudyTrackGoalTurn,
  type StudyTrackGoalEdits,
} from '../../shared/schemas/study-track-goal'
import { StudyTrackInputSchema, type StudyTrack, type StudyTrackInput } from '../../shared/schemas/track'
import { getAdminFirestore } from '../utils/firebase-admin'
import { interpretStudyTrackGoal } from '../utils/openai'
import { listStudyTracks, writeStudyTrack } from './miraistudy-service'

const GoalTrackSchema = StudyTrackInputSchema.extend({ targetDate: z.iso.date() })
const TASK_LIFETIME_MS = 30 * 60 * 1000
const GOAL_LABELS = {
  title: '学習テーマ',
  category: 'カテゴリ',
  targetDate: '試験日・目標日',
  dailyGoalMinutes: '1日の目標学習時間（分）',
  targetTotalHours: '目標総学習時間（時間）',
  targetScorePct: '目標スコア（%）',
  passingScorePct: '合格基準（%）',
} as const
const categories = [
  { value: 'certification', label: '資格' },
  { value: 'programming', label: 'プログラミング' },
  { value: 'language', label: '語学' },
  { value: 'general', label: 'その他' },
]

type GoalTask = {
  state: 'TASK_STATE_INPUT_REQUIRED' | 'TASK_STATE_COMPLETED' | 'TASK_STATE_CANCELED'
  expiresAt: number
  input: StudyTrackInput
  previous: StudyTrack | null
}

function taskRef(uid: string, id: string) {
  return getAdminFirestore().collection('users').doc(uid).collection('a2a_study_track_tasks').doc(id)
}

function agentMessage(text: string, contextId = randomUUID(), taskId?: string, extension?: { extension: string; payload: unknown }) {
  return {
    role: 'ROLE_AGENT',
    messageId: randomUUID(),
    contextId,
    ...(taskId ? { taskId } : {}),
    parts: [{ text }, ...(extension ? [{ data: extension }] : [])],
  }
}

function ask(text: string) {
  return {
    message: agentMessage(text, undefined, undefined, { extension: A2A_EXTENSION_STUDY_TRACK, payload: 'needs_details' }),
  }
}

function editableFields(input: StudyTrackInput) {
  return [
    { key: 'title', label: GOAL_LABELS.title, type: 'text', value: input.title },
    { key: 'category', label: GOAL_LABELS.category, type: 'select', value: input.category, options: categories },
    { key: 'targetDate', label: GOAL_LABELS.targetDate, type: 'datetime', value: input.targetDate },
    { key: 'dailyGoalMinutes', label: '1日の目標学習時間', type: 'number', value: input.dailyGoalMinutes, min: 10, max: 720, unit: '分' },
    { key: 'targetTotalHours', label: '目標総学習時間', type: 'number', value: input.targetTotalHours, min: 1, max: 10000, unit: '時間' },
    { key: 'targetScorePct', label: '目標スコア', type: 'number', value: input.targetScorePct, min: 0, max: 100, unit: '%' },
    { key: 'passingScorePct', label: '合格基準', type: 'number', value: input.passingScorePct, min: 0, max: 100, unit: '%' },
  ]
}

function formatChanges(previous: StudyTrack, input: StudyTrackInput) {
  const fields = Object.keys(GOAL_LABELS) as (keyof typeof GOAL_LABELS)[]
  const displayValue = (key: keyof typeof GOAL_LABELS, value: string | number) =>
    key === 'category' ? categories.find(category => category.value === value)?.label ?? value : value
  return fields.filter(key => input[key] !== previous[key]).map(key =>
    `${GOAL_LABELS[key]}: ${displayValue(key, previous[key])} → ${displayValue(key, input[key])}`)
}

export async function prepareStudyTrackGoal(uid: string, turn: StudyTrackGoalTurn, text: string) {
  const tracks = await listStudyTracks(uid)
  const config = useRuntimeConfig()
  const interpreted = await interpretStudyTrackGoal({
    apiKey: String(config.openaiApiKey ?? ''),
    model: String(config.openaiModel ?? ''),
    today: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', dateStyle: 'short' }).format(new Date()),
    text,
    history: turn.studyTrackGoal === 'continue' ? turn.history : [],
    trackTitles: tracks.map(track => track.title),
  })
  if (interpreted.intent === 'summary') return null
  if (interpreted.intent === 'cancel') return { message: agentMessage('学習目標の設定を中止しました。') }
  if (interpreted.intent === 'clarify') {
    return ask(interpreted.question?.trim().slice(0, 500) || '新しい学習目標を作りますか？ 既存の目標を変更しますか？')
  }

  const previous = interpreted.intent === 'update' ? tracks[(interpreted.trackNumber ?? 0) - 1] : undefined
  if (interpreted.intent === 'update' && !previous) {
    if (!tracks.length) return ask('変更できる学習トラックがありません。新しい目標を作りますか？')
    const choices = tracks.map((track, index) => `${index + 1}. ${track.title}（${track.targetDate}）`).join('\n')
    return ask(`変更したい学習トラックを番号か名前で教えてください。\n\n${choices}`)
  }

  const { title, category, targetDate, dailyGoalMinutes, targetTotalHours, targetScorePct, passingScorePct } = interpreted
  const proposed = { title, category, targetDate, dailyGoalMinutes, targetTotalHours, targetScorePct, passingScorePct }
  const keys = Object.keys(GOAL_LABELS) as (keyof typeof GOAL_LABELS)[]
  const values = Object.fromEntries(keys.map(key => [key, proposed[key] ?? previous?.[key] ?? null]))
  const missing = keys.filter(key => !GoalTrackSchema.shape[key].safeParse(values[key]).success)
  const scheduleNote = interpreted.scheduleNote?.trim().slice(0, 240)
  if (scheduleNote && dailyGoalMinutes === null && !missing.includes('dailyGoalMinutes')) missing.push('dailyGoalMinutes')
  if (missing.length) {
    const schedule = scheduleNote ? `「${scheduleNote}」の場合、1日目標欄に登録する分数も教えてください。\n\n` : ''
    return ask(`${schedule}登録に必要な項目を教えてください。\n\n${missing.map(key => `- ${GOAL_LABELS[key]}`).join('\n')}`)
  }
  if (interpreted.question?.trim()) return ask(interpreted.question.trim().slice(0, 500))

  const id = randomUUID()
  const input = GoalTrackSchema.parse({ ...values, id: previous?.id ?? `track-${id}`, isDefault: previous?.isDefault ?? false })
  const changes = previous ? formatChanges(previous, input) : []
  if (previous && !changes.length) return ask(`「${previous.title}」のどの項目を変更しますか？`)

  const task: GoalTask = { state: 'TASK_STATE_INPUT_REQUIRED', expiresAt: Date.now() + TASK_LIFETIME_MS, input, previous: previous ?? null }
  await taskRef(uid, id).create(task)
  const summary = [
    ...(previous ? [`変更対象: ${previous.title}`, ...changes] : []),
    ...(scheduleNote ? [`学習ペースの希望: ${scheduleNote}`] : []),
  ].join('\n')
  const payload = {
    agentId: A2A_AGENT_ID,
    taskId: id,
    title: previous ? '学習トラックの目標変更' : '学習トラックの新規作成',
    confirmLabel: previous ? '変更を保存' : '学習目標を登録',
    ...(summary ? { summary } : {}),
    fields: editableFields(input),
  }
  return {
    task: {
      id,
      contextId: id,
      status: { state: task.state, message: agentMessage('登録内容を確認し、必要なら修正して確定してください。', id, id, { extension: A2A_EXTENSION_HITL_FORM, payload }) },
    },
  }
}

export async function resolveStudyTrackGoal(uid: string, id: string, edits: StudyTrackGoalEdits | null) {
  const ref = taskRef(uid, id)
  return getAdminFirestore().runTransaction(async transaction => {
    const snapshot = await transaction.get(ref)
    const draft = snapshot.data() as GoalTask | undefined
    if (!draft) throw createError({ statusCode: 404, statusMessage: 'Study goal draft not found.' })
    const state = edits === null ? 'TASK_STATE_CANCELED' : 'TASK_STATE_COMPLETED'
    const receipt = { id, contextId: id, status: { state } }
    if (draft.state === state) return receipt
    if (draft.state !== 'TASK_STATE_INPUT_REQUIRED') {
      throw createError({ statusCode: 409, statusMessage: 'Study goal draft was already resolved.' })
    }
    if (draft.expiresAt <= Date.now()) throw createError({ statusCode: 410, statusMessage: 'Study goal draft expired.' })
    if (edits !== null) {
      const input = GoalTrackSchema.safeParse({ ...draft.input, ...edits })
      if (!input.success) throw createError({ statusCode: 400, statusMessage: 'Invalid study goal fields.' })
      await writeStudyTrack(transaction, uid, input.data, draft.previous)
    }
    transaction.update(ref, { state })
    return receipt
  })
}
