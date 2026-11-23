import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import type { A2aDraftTask, A2aRecordKind } from '../../shared/schemas/a2a'
import { StudySessionInputSchema } from '../../shared/schemas/study-session'
import { ExamLogInputSchema } from '../../shared/schemas/exam-log'
import { DevLogInputSchema } from '../../shared/schemas/dev-log'
import { ReviewItemInputSchema } from '../../shared/schemas/review-item'
import { getAdminFirestore, getAdminStorageBucket } from '../utils/firebase-admin'
import { assertOwnedStagingPath } from '../utils/image-validation'
import {
  createDevLog,
  createExamLog,
  createReviewItems,
  createStudySession,
} from './miraistudy-service'

function taskCollection(uid: string) {
  return getAdminFirestore().collection('users').doc(uid).collection('a2a_tasks')
}

export async function createA2aDraftTask(params: {
  uid: string
  recordKind: A2aRecordKind
  draft: Record<string, unknown>
  stagingImagePath?: string | null
}): Promise<A2aDraftTask> {
  if (params.stagingImagePath) {
    assertOwnedStagingPath(params.uid, params.stagingImagePath)
  }

  const taskId = randomUUID()
  const nowIso = new Date().toISOString()
  const task: A2aDraftTask = {
    taskId,
    uid: params.uid,
    recordKind: params.recordKind,
    status: 'input-required',
    draft: params.draft,
    stagingImagePath: params.stagingImagePath ?? null,
    createdAt: nowIso,
    updatedAt: nowIso,
  }

  await taskCollection(params.uid).doc(taskId).set(task)
  return task
}

export async function getA2aDraftTask(uid: string, taskId: string): Promise<A2aDraftTask> {
  const doc = await taskCollection(uid).doc(taskId).get()
  if (!doc.exists) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found: A2A task does not exist.',
    })
  }
  const data = doc.data()!
  return {
    taskId: doc.id,
    uid,
    recordKind: data.recordKind as A2aRecordKind,
    status: data.status as A2aDraftTask['status'],
    draft: (data.draft ?? {}) as Record<string, unknown>,
    stagingImagePath: typeof data.stagingImagePath === 'string' ? data.stagingImagePath : null,
    createdAt: String(data.createdAt ?? ''),
    updatedAt: String(data.updatedAt ?? ''),
  }
}

export async function commitA2aDraftTask(params: {
  uid: string
  taskId: string
  recordKind: A2aRecordKind
  payload: Record<string, unknown>
}): Promise<{ task: A2aDraftTask; savedRecord: unknown }> {
  const existing = await getA2aDraftTask(params.uid, params.taskId)
  if (existing.status !== 'input-required') {
    throw createError({
      statusCode: 409,
      statusMessage: `Conflict: Task is already in '${existing.status}' state.`,
    })
  }

  let savedRecord: unknown
  if (params.recordKind === 'study_session') {
    const parsed = StudySessionInputSchema.safeParse(params.payload)
    if (!parsed.success) {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request: Invalid study session payload.' })
    }
    savedRecord = await createStudySession(params.uid, parsed.data)
  } else if (params.recordKind === 'exam_log') {
    const parsed = ExamLogInputSchema.safeParse(params.payload)
    if (!parsed.success) {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request: Invalid exam log payload.' })
    }
    savedRecord = await createExamLog(params.uid, parsed.data)
  } else if (params.recordKind === 'dev_log') {
    const parsed = DevLogInputSchema.safeParse(params.payload)
    if (!parsed.success) {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request: Invalid dev log payload.' })
    }
    savedRecord = await createDevLog(params.uid, parsed.data)
  } else {
    const parsed = ReviewItemInputSchema.safeParse(params.payload)
    if (!parsed.success) {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request: Invalid review item payload.' })
    }
    const created = await createReviewItems(params.uid, [parsed.data])
    savedRecord = created[0]
  }

  const nowIso = new Date().toISOString()
  await taskCollection(params.uid).doc(params.taskId).update({
    status: 'completed',
    updatedAt: nowIso,
  })

  return {
    task: { ...existing, status: 'completed', updatedAt: nowIso },
    savedRecord,
  }
}

export async function cancelA2aDraftTask(uid: string, taskId: string): Promise<A2aDraftTask> {
  const existing = await getA2aDraftTask(uid, taskId)
  if (existing.status === 'completed') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict: Completed task cannot be canceled.',
    })
  }

  if (existing.stagingImagePath) {
    assertOwnedStagingPath(uid, existing.stagingImagePath)
    try {
      const bucket = getAdminStorageBucket()
      await bucket.file(existing.stagingImagePath).delete({ ignoreNotFound: true })
    } catch {
      // Best-effort staging cleanup
    }
  }

  const nowIso = new Date().toISOString()
  await taskCollection(uid).doc(taskId).update({
    status: 'canceled',
    stagingImagePath: null,
    updatedAt: nowIso,
  })

  return {
    ...existing,
    status: 'canceled',
    stagingImagePath: null,
    updatedAt: nowIso,
  }
}
