import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveStudyTrackGoal } from '../server/domain/study-track-goal'

const fixture = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>()
  const write = vi.fn()
  const db = {
    collection: (name: string) => ({ doc: (uid: string) => ({
      collection: (collection: string) => ({ doc: (id: string) => `${name}/${uid}/${collection}/${id}` }),
    }) }),
    runTransaction: async <T>(operation: (transaction: {
      get: (path: string) => Promise<{ data: () => Record<string, unknown> | undefined }>
      update: (path: string, values: Record<string, unknown>) => void
    }) => Promise<T>) => {
      const pending = new Map<string, Record<string, unknown>>()
      const result = await operation({
        get: async path => ({ data: () => docs.get(path) }),
        update: (path, values) => pending.set(path, { ...docs.get(path), ...values }),
      })
      for (const [path, value] of pending) docs.set(path, value)
      return result
    },
  }
  return { docs, db, write }
})

vi.mock('../server/utils/firebase-admin', () => ({ getAdminFirestore: () => fixture.db }))
vi.mock('../server/domain/miraistudy-service', () => ({ writeStudyTrack: fixture.write, listStudyTracks: vi.fn() }))

describe('study goal confirmation', () => {
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
