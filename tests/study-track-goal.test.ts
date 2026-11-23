import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareStudyTrackGoal, resolveStudyTrackGoal } from '../server/domain/study-track-goal'
import * as openaiUtils from '../server/utils/openai'
import * as miraistudyService from '../server/domain/miraistudy-service'

const fixture = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>()
  const write = vi.fn()
  const db = {
    collection: (name: string) => ({
      doc: (uid: string) => ({
        collection: (collection: string) => ({
          doc: (id: string) => {
            const path = `${name}/${uid}/${collection}/${id}`
            return {
              path,
              create: async (data: Record<string, unknown>) => {
                docs.set(path, data)
              },
            }
          },
        }),
      }),
    }),
    runTransaction: async <T>(
      operation: (transaction: {
        get: (refOrPath: { path: string } | string) => Promise<{ data: () => Record<string, unknown> | undefined }>
        update: (refOrPath: { path: string } | string, values: Record<string, unknown>) => void
      }) => Promise<T>,
    ) => {
      const pending = new Map<string, Record<string, unknown>>()
      const getPath = (refOrPath: { path: string } | string) => (typeof refOrPath === 'string' ? refOrPath : refOrPath.path)
      const result = await operation({
        get: async (refOrPath) => ({ data: () => docs.get(getPath(refOrPath)) }),
        update: (refOrPath, values) => {
          const p = getPath(refOrPath)
          pending.set(p, { ...docs.get(p), ...values })
        },
      })
      for (const [path, value] of pending) docs.set(path, value)
      return result
    },
  }
  return { docs, db, write }
})

vi.mock('../server/utils/firebase-admin', () => ({ getAdminFirestore: () => fixture.db }))
vi.mock('../server/domain/miraistudy-service', () => ({
  writeStudyTrack: fixture.write,
  listStudyTracks: vi.fn(),
}))
vi.stubGlobal('useRuntimeConfig', () => ({ openaiApiKey: 'test-key', openaiModel: 'gpt-4.1-mini' }))

vi.mock('../server/utils/openai', async (importOriginal) => {
  const actual = await importOriginal<typeof openaiUtils>()
  return {
    ...actual,
    interpretStudyTrackGoal: vi.fn(),
  }
})

describe('study track goal domain logic', () => {
  const uid = 'owner'

  beforeEach(() => {
    fixture.docs.clear()
    fixture.write.mockReset()
    vi.mocked(miraistudyService.listStudyTracks).mockResolvedValue([])
  })

  it('prepares create goal with suggested values and assumedFields summary', async () => {
    vi.mocked(openaiUtils.interpretStudyTrackGoal).mockResolvedValueOnce({
      intent: 'create',
      trackNumber: null,
      title: 'PL900',
      category: 'certification',
      targetDate: '2026-12-07',
      dailyGoalMinutes: null,
      targetTotalHours: null,
      targetScorePct: null,
      passingScorePct: null,
      scheduleNote: '平日は忙しいです',
      question: null,
      assumedFields: ['dailyGoalMinutes', 'targetTotalHours', 'targetScorePct', 'passingScorePct'],
    })

    const result = await prepareStudyTrackGoal(uid, { studyTrackGoal: 'start', history: [] }, 'PL900を12月初週まで') as Record<string, unknown>
    expect(result.task).toBeDefined()
    const taskObj = result.task as Record<string, unknown>
    const statusObj = taskObj.status as Record<string, unknown>
    expect(statusObj.state).toBe('TASK_STATE_INPUT_REQUIRED')
    const messageObj = statusObj.message as Record<string, unknown>
    const parts = messageObj.parts as Array<Record<string, unknown>>
    const extObj = parts.find((p) => p.data) as Record<string, unknown> | undefined
    const extData = extObj?.data as Record<string, unknown> | undefined
    const payload = extData?.payload as Record<string, unknown> | undefined
    const summary = String(payload?.summary ?? '')
    expect(summary).toContain('AIが目安値を自動入力しました')
    expect(summary).toContain('学習ペースの希望: 平日は忙しいです')
  })

  it('safely falls back when LLM returns out-of-range values or past targetDate', async () => {
    vi.mocked(openaiUtils.interpretStudyTrackGoal).mockResolvedValueOnce({
      intent: 'create',
      trackNumber: null,
      title: '過去日付の試験',
      category: null,
      targetDate: '2020-01-01',
      dailyGoalMinutes: 5,
      targetTotalHours: -10,
      targetScorePct: 150,
      passingScorePct: 120,
      scheduleNote: null,
      question: null,
      assumedFields: ['category', 'dailyGoalMinutes', 'targetTotalHours', 'targetScorePct', 'passingScorePct'],
    })

    const result = await prepareStudyTrackGoal(uid, { studyTrackGoal: 'start', history: [] }, '過去日付の試験') as Record<string, unknown>
    expect(result.task).toBeDefined()
    const taskObj = result.task as Record<string, unknown>
    const statusObj = taskObj.status as Record<string, unknown>
    expect(statusObj.state).toBe('TASK_STATE_INPUT_REQUIRED')
    const messageObj = statusObj.message as Record<string, unknown>
    const parts = messageObj.parts as Array<Record<string, unknown>>
    const extObj = parts.find((p) => p.data) as Record<string, unknown> | undefined
    const extData = extObj?.data as Record<string, unknown> | undefined
    const payload = extData?.payload as Record<string, unknown> | undefined
    const summary = String(payload?.summary ?? '')
    expect(summary).toContain('AIが目安値を自動入力しました')

    const fields = payload?.fields as Array<Record<string, unknown>>
    const dailyGoalField = fields.find((f) => f.key === 'dailyGoalMinutes')
    const passingScoreField = fields.find((f) => f.key === 'passingScorePct')
    expect(Number(dailyGoalField?.value)).toBeGreaterThanOrEqual(10)
    expect(Number(dailyGoalField?.value)).toBeLessThanOrEqual(720)
    expect(Number(passingScoreField?.value)).toBe(70)
  })

  it('asks for details if title or targetDate is missing on create', async () => {
    vi.mocked(openaiUtils.interpretStudyTrackGoal).mockResolvedValueOnce({
      intent: 'create',
      trackNumber: null,
      title: 'PL900',
      category: null,
      targetDate: null,
      dailyGoalMinutes: null,
      targetTotalHours: null,
      targetScorePct: null,
      passingScorePct: null,
      scheduleNote: null,
      question: null,
      assumedFields: [],
    })

    const result = await prepareStudyTrackGoal(uid, { studyTrackGoal: 'start', history: [] }, 'PL900') as Record<string, unknown>
    expect(result.message).toBeDefined()
  })

  it('updates existing track without overwriting unspecified fields', async () => {
    vi.mocked(miraistudyService.listStudyTracks).mockResolvedValueOnce([
      {
        id: 'track-1',
        title: '既存トラック',
        category: 'programming',
        targetDate: '2026-12-31',
        dailyGoalMinutes: 30,
        targetTotalHours: 50,
        targetScorePct: 80,
        passingScorePct: 70,
        isDefault: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ])

    vi.mocked(openaiUtils.interpretStudyTrackGoal).mockResolvedValueOnce({
      intent: 'update',
      trackNumber: 1,
      title: '既存トラック更新',
      category: null,
      targetDate: null,
      dailyGoalMinutes: null,
      targetTotalHours: null,
      targetScorePct: null,
      passingScorePct: null,
      scheduleNote: null,
      question: null,
      assumedFields: [],
    })

    const result = await prepareStudyTrackGoal(uid, { studyTrackGoal: 'start', history: [] }, 'タイトルを既存トラック更新に変更') as Record<string, unknown>
    expect(result.task).toBeDefined()
  })
})

describe('study goal confirmation existing tests', () => {
  const uid = 'owner'
  const id = 'task-id'
  const key = `users/${uid}/a2a_study_track_tasks/${id}`
  const input = {
    id: 'existing-track',
    title: '資格試験',
    category: 'certification',
    targetDate: '2027-03-15',
    dailyGoalMinutes: 30,
    targetTotalHours: 100,
    targetScorePct: 80,
    passingScorePct: 70,
    isDefault: true,
  }
  const previous = { ...input, dailyGoalMinutes: 20, createdAt: 'created', updatedAt: 'updated' }

  beforeEach(() => {
    fixture.docs.clear()
    fixture.write.mockReset()
    fixture.docs.set(key, { input, previous, state: 'TASK_STATE_INPUT_REQUIRED', expiresAt: Date.now() + 60_000 })
  })

  it('applies edited values to the original track and returns the same result on retry', async () => {
    const result = await resolveStudyTrackGoal(uid, id, { dailyGoalMinutes: 45 })
    expect(result.status.state).toBe('TASK_STATE_COMPLETED')
    expect(fixture.write).toHaveBeenCalledWith(expect.anything(), uid, { ...input, dailyGoalMinutes: 45 }, previous)
    expect(await resolveStudyTrackGoal(uid, id, { dailyGoalMinutes: 45 })).toEqual(result)
    expect(fixture.write).toHaveBeenCalledTimes(1)
  })

  it('rejects another owner, invalid dates, cancelled and expired drafts', async () => {
    await expect(resolveStudyTrackGoal('other', id, {})).rejects.toMatchObject({ statusCode: 404 })
    await expect(resolveStudyTrackGoal(uid, id, { targetDate: '2027-02-30' })).rejects.toMatchObject({ statusCode: 400 })
    expect((await resolveStudyTrackGoal(uid, id, null)).status.state).toBe('TASK_STATE_CANCELED')
    await expect(resolveStudyTrackGoal(uid, id, {})).rejects.toMatchObject({ statusCode: 409 })
    fixture.docs.set(key, { ...fixture.docs.get(key), state: 'TASK_STATE_INPUT_REQUIRED', expiresAt: 0 })
    await expect(resolveStudyTrackGoal(uid, id, {})).rejects.toMatchObject({ statusCode: 410 })
    expect(fixture.write).not.toHaveBeenCalled()
  })

  it('keeps the draft pending if the track was changed since the draft was created', async () => {
    fixture.write.mockRejectedValueOnce({ statusCode: 409 })
    await expect(resolveStudyTrackGoal(uid, id, {})).rejects.toMatchObject({ statusCode: 409 })
    expect(fixture.docs.get(key)?.state).toBe('TASK_STATE_INPUT_REQUIRED')
  })
})
