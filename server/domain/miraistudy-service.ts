import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import { MAX_STUDY_TRACKS, type StudyTrack, type StudyTrackInput } from '../../shared/schemas/track'
import type { StudySession, StudySessionInput } from '../../shared/schemas/study-session'
import type { ExamLog, ExamLogInput } from '../../shared/schemas/exam-log'
import type { DevLog, DevLogInput } from '../../shared/schemas/dev-log'
import type { ReviewGrade, ReviewItem, ReviewItemInput, ReviewStatus } from '../../shared/schemas/review-item'
import { computeNextReviewSchedule, runStudySimulation, todayIsoUtc } from '../../shared/domain/simulation'
import type { SimulationResponse } from '../../shared/schemas/simulation'
import { getAdminFirestore } from '../utils/firebase-admin'
import { assertOwnedImagePath } from '../utils/image-validation'

function userCollection(uid: string, name: string) {
  return getAdminFirestore().collection('users').doc(uid).collection(name)
}

function studyTracksQuery(uid: string) {
  return userCollection(uid, 'tracks')
    .orderBy('createdAt', 'asc')
    .limit(MAX_STUDY_TRACKS)
    .select(
      'title',
      'category',
      'targetDate',
      'targetScorePct',
      'passingScorePct',
      'targetTotalHours',
      'dailyGoalMinutes',
      'isDefault',
      'createdAt',
      'updatedAt',
    )
}

function mapStudyTracks(snap: FirebaseFirestore.QuerySnapshot): StudyTrack[] {
  return snap.docs.map((doc) => {
    const data = doc.data()
    return {
      id: doc.id,
      title: String(data.title ?? ''),
      category: data.category as StudyTrack['category'],
      targetDate: String(data.targetDate ?? ''),
      targetScorePct: Number(data.targetScorePct ?? 80),
      passingScorePct: Number(data.passingScorePct ?? 70),
      targetTotalHours: Number(data.targetTotalHours ?? 100),
      dailyGoalMinutes: Number(data.dailyGoalMinutes ?? 60),
      isDefault: Boolean(data.isDefault),
      createdAt: String(data.createdAt ?? ''),
      updatedAt: String(data.updatedAt ?? ''),
    }
  })
}

export async function listStudyTracks(uid: string): Promise<StudyTrack[]> {
  return mapStudyTracks(await studyTracksQuery(uid).get())
}

export async function writeStudyTrack(
  transaction: FirebaseFirestore.Transaction,
  uid: string,
  input: StudyTrackInput,
  expectedTrack?: StudyTrack | null,
): Promise<StudyTrack> {
  const col = userCollection(uid, 'tracks')
  const existing = mapStudyTracks(await transaction.get(studyTracksQuery(uid)))
  const nowIso = new Date().toISOString()

  const trackId = input.id ?? `track-${randomUUID().slice(0, 8)}`
  const existingTrack = existing.find((t) => t.id === trackId)
  if (expectedTrack !== undefined && (
    expectedTrack === null ? Boolean(existingTrack)
      : !existingTrack || Object.keys(existingTrack).some(key =>
        existingTrack[key as keyof StudyTrack] !== expectedTrack[key as keyof StudyTrack])
  )) {
    throw createError({ statusCode: 409, statusMessage: 'Conflict: Study track has changed.' })
  }

  if (!existingTrack && existing.length >= MAX_STUDY_TRACKS) {
    throw createError({
      statusCode: 400,
      statusMessage: `Bad Request: Maximum of ${MAX_STUDY_TRACKS} study tracks reached.`,
    })
  }

  const shouldBeDefault = input.isDefault || existing.length === 0

  if (shouldBeDefault) {
    for (const other of existing) {
      if (other.id !== trackId && other.isDefault) {
        transaction.update(col.doc(other.id), { isDefault: false, updatedAt: nowIso })
      }
    }
  }

  const record: StudyTrack = {
    id: trackId,
    title: input.title,
    category: input.category,
    targetDate: input.targetDate,
    targetScorePct: input.targetScorePct,
    passingScorePct: input.passingScorePct,
    targetTotalHours: input.targetTotalHours,
    dailyGoalMinutes: input.dailyGoalMinutes,
    isDefault: shouldBeDefault,
    createdAt: existingTrack?.createdAt ?? nowIso,
    updatedAt: nowIso,
  }

  transaction.set(col.doc(trackId), {
    title: record.title,
    category: record.category,
    targetDate: record.targetDate,
    targetScorePct: record.targetScorePct,
    passingScorePct: record.passingScorePct,
    targetTotalHours: record.targetTotalHours,
    dailyGoalMinutes: record.dailyGoalMinutes,
    isDefault: record.isDefault,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  })

  return record
}

export async function upsertStudyTrack(uid: string, input: StudyTrackInput): Promise<StudyTrack> {
  return getAdminFirestore().runTransaction(transaction => writeStudyTrack(transaction, uid, input))
}

export async function listStudySessions(
  uid: string,
  options: { trackId?: string; limit?: number } = {},
): Promise<StudySession[]> {
  const limit = Math.min(180, Math.max(1, options.limit ?? 60))
  let query: FirebaseFirestore.Query = userCollection(uid, 'study_sessions')
  if (options.trackId) {
    query = query.where('trackId', '==', options.trackId)
  }

  const snap = await query
    .orderBy('studiedDate', 'desc')
    .limit(limit)
    .select(
      'trackId',
      'studiedDate',
      'durationMinutes',
      'materialOrTopic',
      'category',
      'focusLevel',
      'memo',
      'imagePath',
      'createdAt',
    )
    .get()

  return snap.docs.map((doc) => {
    const data = doc.data()
    return {
      id: doc.id,
      trackId: String(data.trackId ?? ''),
      studiedDate: String(data.studiedDate ?? ''),
      durationMinutes: Number(data.durationMinutes ?? 0),
      materialOrTopic: String(data.materialOrTopic ?? ''),
      category: data.category as StudySession['category'],
      focusLevel: Number(data.focusLevel ?? 3),
      ...(typeof data.memo === 'string' ? { memo: data.memo } : {}),
      ...(typeof data.imagePath === 'string' ? { imagePath: data.imagePath } : {}),
      createdAt: String(data.createdAt ?? ''),
    }
  })
}

export async function createStudySession(uid: string, input: StudySessionInput): Promise<StudySession> {
  if (input.imagePath) {
    assertOwnedImagePath(uid, input.imagePath)
  }
  const nowIso = new Date().toISOString()
  const docRef = userCollection(uid, 'study_sessions').doc()
  const payload = {
    trackId: input.trackId,
    studiedDate: input.studiedDate,
    durationMinutes: input.durationMinutes,
    materialOrTopic: input.materialOrTopic,
    category: input.category,
    focusLevel: input.focusLevel,
    ...(input.memo !== undefined ? { memo: input.memo } : {}),
    ...(input.imagePath !== undefined ? { imagePath: input.imagePath } : {}),
    createdAt: nowIso,
  }
  await docRef.set(payload)
  return { id: docRef.id, ...payload }
}

export async function listExamLogs(
  uid: string,
  options: { trackId?: string; limit?: number } = {},
): Promise<ExamLog[]> {
  const limit = Math.min(180, Math.max(1, options.limit ?? 60))
  let query: FirebaseFirestore.Query = userCollection(uid, 'exam_logs')
  if (options.trackId) {
    query = query.where('trackId', '==', options.trackId)
  }

  const snap = await query
    .orderBy('takenDate', 'desc')
    .limit(limit)
    .select(
      'trackId',
      'takenDate',
      'examName',
      'scorePct',
      'correctCount',
      'totalQuestions',
      'domainArea',
      'weakTopics',
      'memo',
      'imagePath',
      'createdAt',
    )
    .get()

  return snap.docs.map((doc) => {
    const data = doc.data()
    return {
      id: doc.id,
      trackId: String(data.trackId ?? ''),
      takenDate: String(data.takenDate ?? ''),
      examName: String(data.examName ?? ''),
      scorePct: Number(data.scorePct ?? 0),
      ...(typeof data.correctCount === 'number' ? { correctCount: data.correctCount } : {}),
      ...(typeof data.totalQuestions === 'number' ? { totalQuestions: data.totalQuestions } : {}),
      ...(typeof data.domainArea === 'string' ? { domainArea: data.domainArea } : {}),
      weakTopics: Array.isArray(data.weakTopics) ? data.weakTopics.map(String) : [],
      ...(typeof data.memo === 'string' ? { memo: data.memo } : {}),
      ...(typeof data.imagePath === 'string' ? { imagePath: data.imagePath } : {}),
      createdAt: String(data.createdAt ?? ''),
    }
  })
}

export async function createExamLog(uid: string, input: ExamLogInput): Promise<ExamLog> {
  if (input.imagePath) {
    assertOwnedImagePath(uid, input.imagePath)
  }
  const nowIso = new Date().toISOString()
  const docRef = userCollection(uid, 'exam_logs').doc()
  const payload = {
    trackId: input.trackId,
    takenDate: input.takenDate,
    examName: input.examName,
    scorePct: input.scorePct,
    ...(input.correctCount !== undefined ? { correctCount: input.correctCount } : {}),
    ...(input.totalQuestions !== undefined ? { totalQuestions: input.totalQuestions } : {}),
    ...(input.domainArea !== undefined ? { domainArea: input.domainArea } : {}),
    weakTopics: input.weakTopics,
    ...(input.memo !== undefined ? { memo: input.memo } : {}),
    ...(input.imagePath !== undefined ? { imagePath: input.imagePath } : {}),
    createdAt: nowIso,
  }
  await docRef.set(payload)
  return { id: docRef.id, ...payload }
}

export async function listDevLogs(
  uid: string,
  options: { trackId?: string; limit?: number } = {},
): Promise<DevLog[]> {
  const limit = Math.min(180, Math.max(1, options.limit ?? 60))
  let query: FirebaseFirestore.Query = userCollection(uid, 'dev_logs')
  if (options.trackId) {
    query = query.where('trackId', '==', options.trackId)
  }

  const snap = await query
    .orderBy('loggedDate', 'desc')
    .limit(limit)
    .select(
      'trackId',
      'loggedDate',
      'featureSummary',
      'completedTasks',
      'handsOnMinutes',
      'tags',
      'commitOrArtifactNote',
      'createdAt',
    )
    .get()

  return snap.docs.map((doc) => {
    const data = doc.data()
    return {
      id: doc.id,
      trackId: String(data.trackId ?? ''),
      loggedDate: String(data.loggedDate ?? ''),
      featureSummary: String(data.featureSummary ?? ''),
      completedTasks: Number(data.completedTasks ?? 0),
      handsOnMinutes: Number(data.handsOnMinutes ?? 0),
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      ...(typeof data.commitOrArtifactNote === 'string' ? { commitOrArtifactNote: data.commitOrArtifactNote } : {}),
      createdAt: String(data.createdAt ?? ''),
    }
  })
}

export async function createDevLog(uid: string, input: DevLogInput): Promise<DevLog> {
  const nowIso = new Date().toISOString()
  const docRef = userCollection(uid, 'dev_logs').doc()
  const payload = {
    trackId: input.trackId,
    loggedDate: input.loggedDate,
    featureSummary: input.featureSummary,
    completedTasks: input.completedTasks,
    handsOnMinutes: input.handsOnMinutes,
    tags: input.tags,
    ...(input.commitOrArtifactNote !== undefined ? { commitOrArtifactNote: input.commitOrArtifactNote } : {}),
    createdAt: nowIso,
  }
  await docRef.set(payload)
  return { id: docRef.id, ...payload }
}

export async function listReviewItems(
  uid: string,
  options: { trackId?: string; status?: ReviewStatus; dueOnly?: boolean; limit?: number } = {},
): Promise<{ items: ReviewItem[]; dueCount: number }> {
  const limit = Math.min(200, Math.max(1, options.limit ?? 100))
  let query: FirebaseFirestore.Query = userCollection(uid, 'review_items')
  if (options.trackId) {
    query = query.where('trackId', '==', options.trackId)
  }
  if (options.status) {
    query = query.where('status', '==', options.status)
  }

  const snap = await query
    .orderBy('nextReviewDate', 'asc')
    .limit(limit)
    .select(
      'trackId',
      'topic',
      'questionOrPrompt',
      'answerOrNote',
      'stage',
      'nextReviewDate',
      'lastReviewedAt',
      'status',
      'createdAt',
    )
    .get()

  const today = todayIsoUtc()
  const allItems: ReviewItem[] = snap.docs.map((doc) => {
    const data = doc.data()
    return {
      id: doc.id,
      trackId: String(data.trackId ?? ''),
      topic: String(data.topic ?? ''),
      questionOrPrompt: String(data.questionOrPrompt ?? ''),
      answerOrNote: String(data.answerOrNote ?? ''),
      stage: Number(data.stage ?? 0),
      nextReviewDate: String(data.nextReviewDate ?? today),
      lastReviewedAt: typeof data.lastReviewedAt === 'string' ? data.lastReviewedAt : null,
      status: (data.status === 'mastered' ? 'mastered' : 'active') as ReviewStatus,
      createdAt: String(data.createdAt ?? ''),
    }
  })

  const dueCount = allItems.filter((item) => item.status === 'active' && item.nextReviewDate <= today).length
  const filtered = options.dueOnly
    ? allItems.filter((item) => item.status === 'active' && item.nextReviewDate <= today)
    : allItems

  return { items: filtered, dueCount }
}

export async function createReviewItems(uid: string, inputs: ReviewItemInput[]): Promise<ReviewItem[]> {
  const db = getAdminFirestore()
  const col = userCollection(uid, 'review_items')
  const batch = db.batch()
  const nowIso = new Date().toISOString()
  const defaultNextDate = todayIsoUtc()

  const created: ReviewItem[] = inputs.map((input) => {
    const docRef = col.doc()
    const item: ReviewItem = {
      id: docRef.id,
      trackId: input.trackId,
      topic: input.topic,
      questionOrPrompt: input.questionOrPrompt,
      answerOrNote: input.answerOrNote,
      stage: 0,
      nextReviewDate: input.nextReviewDate ?? defaultNextDate,
      lastReviewedAt: null,
      status: 'active',
      createdAt: nowIso,
    }
    batch.set(docRef, {
      trackId: item.trackId,
      topic: item.topic,
      questionOrPrompt: item.questionOrPrompt,
      answerOrNote: item.answerOrNote,
      stage: item.stage,
      nextReviewDate: item.nextReviewDate,
      lastReviewedAt: item.lastReviewedAt,
      status: item.status,
      createdAt: item.createdAt,
    })
    return item
  })

  await batch.commit()
  return created
}

export async function gradeReviewItem(
  uid: string,
  itemId: string,
  grade: ReviewGrade,
): Promise<ReviewItem> {
  const docRef = userCollection(uid, 'review_items').doc(itemId)
  const doc = await docRef.get()
  if (!doc.exists) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found: Review item does not exist.',
    })
  }

  const data = doc.data()!
  const currentStage = Number(data.stage ?? 0)
  const today = todayIsoUtc()
  const next = computeNextReviewSchedule(currentStage, grade, today)
  const nowIso = new Date().toISOString()

  await docRef.update({
    stage: next.stage,
    nextReviewDate: next.nextReviewDate,
    status: next.status,
    lastReviewedAt: nowIso,
  })

  return {
    id: doc.id,
    trackId: String(data.trackId ?? ''),
    topic: String(data.topic ?? ''),
    questionOrPrompt: String(data.questionOrPrompt ?? ''),
    answerOrNote: String(data.answerOrNote ?? ''),
    stage: next.stage,
    nextReviewDate: next.nextReviewDate,
    lastReviewedAt: nowIso,
    status: next.status,
    createdAt: String(data.createdAt ?? ''),
  }
}

export async function getStudySimulationForUser(
  uid: string,
  options: { trackId?: string; dailyMinutesOverride?: number } = {},
): Promise<SimulationResponse> {
  const tracks = await listStudyTracks(uid)
  const selectedTrack =
    (options.trackId ? tracks.find((t) => t.id === options.trackId) : undefined) ??
    tracks.find((t) => t.isDefault) ??
    tracks[0] ??
    null

  if (!selectedTrack) {
    return runStudySimulation({
      track: null,
      studySessions: [],
      examLogs: [],
      reviewItems: [],
      dailyMinutesOverride: options.dailyMinutesOverride,
    })
  }

  const [studySessions, examLogs, reviewsResult] = await Promise.all([
    listStudySessions(uid, { trackId: selectedTrack.id, limit: 180 }),
    listExamLogs(uid, { trackId: selectedTrack.id, limit: 180 }),
    listReviewItems(uid, { trackId: selectedTrack.id, status: 'active', limit: 200 }),
  ])

  return runStudySimulation({
    track: selectedTrack,
    studySessions,
    examLogs,
    reviewItems: reviewsResult.items,
    dailyMinutesOverride: options.dailyMinutesOverride,
  })
}

export interface StudySummarySnapshot {
  tracks: StudyTrack[]
  selectedTrack: StudyTrack | null
  simulation: SimulationResponse
  recentSessions: StudySession[]
  recentExamLogs: ExamLog[]
  dueReviewCount: number
  activeReviewCount: number
}

export async function getStudySummaryForUser(
  uid: string,
  options: { trackId?: string } = {},
): Promise<StudySummarySnapshot> {
  const tracks = await listStudyTracks(uid)
  const selectedTrack =
    (options.trackId ? tracks.find((t) => t.id === options.trackId) : undefined) ??
    tracks.find((t) => t.isDefault) ??
    tracks[0] ??
    null

  if (!selectedTrack) {
    const simulation = runStudySimulation({
      track: null,
      studySessions: [],
      examLogs: [],
      reviewItems: [],
    })
    return {
      tracks,
      selectedTrack: null,
      simulation,
      recentSessions: [],
      recentExamLogs: [],
      dueReviewCount: 0,
      activeReviewCount: 0,
    }
  }

  // Single-pass parallel fetch: each collection is queried at most once
  const [studySessions, examLogs, reviewsResult] = await Promise.all([
    listStudySessions(uid, { trackId: selectedTrack.id, limit: 180 }),
    listExamLogs(uid, { trackId: selectedTrack.id, limit: 180 }),
    listReviewItems(uid, { trackId: selectedTrack.id, status: 'active', limit: 200 }),
  ])

  const simulation = runStudySimulation({
    track: selectedTrack,
    studySessions,
    examLogs,
    reviewItems: reviewsResult.items,
  })

  return {
    tracks,
    selectedTrack,
    simulation,
    recentSessions: studySessions.slice(0, 5),
    recentExamLogs: examLogs.slice(0, 5),
    dueReviewCount: reviewsResult.dueCount,
    activeReviewCount: reviewsResult.items.length,
  }
}

export interface StudyDetailSnapshotData {
  tracks: StudyTrack[]
  selectedTrack: StudyTrack | null
  simulation: SimulationResponse
  sessions: StudySession[]
  examLogs: ExamLog[]
  reviews: ReviewItem[]
  dueReviewCount: number
  devLogs: DevLog[]
}

export async function getStudyDetailSnapshotDataForUser(
  uid: string,
  options: { trackId?: string } = {},
): Promise<StudyDetailSnapshotData> {
  const tracks = await listStudyTracks(uid)
  const selectedTrack =
    (options.trackId ? tracks.find((t) => t.id === options.trackId) : undefined) ??
    tracks.find((t) => t.isDefault) ??
    tracks[0] ??
    null

  if (!selectedTrack) {
    return {
      tracks,
      selectedTrack: null,
      simulation: runStudySimulation({
        track: null,
        studySessions: [],
        examLogs: [],
        reviewItems: [],
      }),
      sessions: [],
      examLogs: [],
      reviews: [],
      dueReviewCount: 0,
      devLogs: [],
    }
  }

  const [sessions, examLogs, reviewsResult, devLogs] = await Promise.all([
    listStudySessions(uid, { trackId: selectedTrack.id, limit: 180 }),
    listExamLogs(uid, { trackId: selectedTrack.id, limit: 180 }),
    listReviewItems(uid, { trackId: selectedTrack.id, status: 'active', limit: 200 }),
    listDevLogs(uid, { trackId: selectedTrack.id, limit: 30 }),
  ])

  const simulation = runStudySimulation({
    track: selectedTrack,
    studySessions: sessions,
    examLogs,
    reviewItems: reviewsResult.items,
  })

  return {
    tracks,
    selectedTrack,
    simulation,
    sessions,
    examLogs,
    reviews: reviewsResult.items,
    dueReviewCount: reviewsResult.dueCount,
    devLogs,
  }
}
