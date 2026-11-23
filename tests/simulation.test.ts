import { describe, expect, it } from 'vitest'
import {
  computeNextReviewSchedule,
  runStudySimulation,
} from '../shared/domain/simulation'
import { MAX_SIMULATION_DAYS } from '../shared/schemas/simulation'
import type { StudyTrack } from '../shared/schemas/track'
import type { StudySession } from '../shared/schemas/study-session'
import type { ExamLog } from '../shared/schemas/exam-log'
import type { ReviewItem } from '../shared/schemas/review-item'

const sampleTrack: StudyTrack = {
  id: 'aws-saa',
  title: 'AWS SAA',
  category: 'certification',
  targetDate: '2027-02-20',
  targetScorePct: 80,
  passingScorePct: 72,
  targetTotalHours: 120,
  dailyGoalMinutes: 90,
  isDefault: true,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
}

const sampleSessions: StudySession[] = [
  {
    id: 's1',
    trackId: 'aws-saa',
    studiedDate: '2026-11-15',
    durationMinutes: 90,
    materialOrTopic: 'IAM & VPC',
    category: 'lecture',
    focusLevel: 4,
    createdAt: '2026-11-15T12:00:00Z',
  },
  {
    id: 's2',
    trackId: 'aws-saa',
    studiedDate: '2026-11-20',
    durationMinutes: 120,
    materialOrTopic: 'Practice Exam Review',
    category: 'practice',
    focusLevel: 5,
    createdAt: '2026-11-20T12:00:00Z',
  },
]

const sampleExams: ExamLog[] = [
  {
    id: 'e1',
    trackId: 'aws-saa',
    takenDate: '2026-11-10',
    examName: 'Mock 1',
    scorePct: 55,
    weakTopics: ['VPC'],
    createdAt: '2026-11-10T12:00:00Z',
  },
  {
    id: 'e2',
    trackId: 'aws-saa',
    takenDate: '2026-11-20',
    examName: 'Mock 2',
    scorePct: 62,
    weakTopics: ['KMS'],
    createdAt: '2026-11-20T12:00:00Z',
  },
]

describe('shared/domain/simulation', () => {
  it('returns needs_setup (Fail-Closed) when track is missing', () => {
    const res = runStudySimulation({
      track: null,
      studySessions: [],
      examLogs: [],
      reviewItems: [],
      asOfDate: '2026-11-22',
    })
    expect(res.status).toBe('needs_setup')
    if (res.status === 'needs_setup') {
      expect(res.missing).toContain('study_track')
    }
  })

  it('returns needs_setup when both sessions and exams are empty', () => {
    const res = runStudySimulation({
      track: sampleTrack,
      studySessions: [],
      examLogs: [],
      reviewItems: [],
      asOfDate: '2026-11-22',
    })
    expect(res.status).toBe('needs_setup')
  })

  it('projects 3 scenarios with intensive >= target and respects dailyMinutesOverride', () => {
    const res = runStudySimulation({
      track: sampleTrack,
      studySessions: sampleSessions,
      examLogs: sampleExams,
      reviewItems: [],
      asOfDate: '2026-11-22',
      dailyMinutesOverride: 150,
    })

    expect(res.status).toBe('ready')
    if (res.status === 'ready') {
      expect(res.effectiveDailyGoalMinutes).toBe(150)
      expect(res.scenarios.intensive_pace.projectedScoreAtTargetDate).toBeGreaterThanOrEqual(
        res.scenarios.target_pace.projectedScoreAtTargetDate,
      )
      expect(res.points.length).toBeGreaterThan(14)
    }
  })

  it('enforces MAX_SIMULATION_DAYS hard cap for far future target dates', () => {
    const farTrack: StudyTrack = { ...sampleTrack, targetDate: '2035-01-01' }
    const res = runStudySimulation({
      track: farTrack,
      studySessions: sampleSessions,
      examLogs: sampleExams,
      reviewItems: [],
      asOfDate: '2026-11-22',
    })
    expect(res.status).toBe('ready')
    if (res.status === 'ready') {
      expect(res.points.length).toBeLessThanOrEqual(MAX_SIMULATION_DAYS + 1)
    }
  })

  it('triggers retentionAlert when overdue review items exist', () => {
    const overdueReviews: ReviewItem[] = Array.from({ length: 9 }, (_, i) => ({
      id: `r${i}`,
      trackId: 'aws-saa',
      topic: `Topic ${i}`,
      questionOrPrompt: 'Q?',
      answerOrNote: 'A',
      stage: 1,
      nextReviewDate: '2026-11-18',
      lastReviewedAt: null,
      status: 'active',
      createdAt: '2026-11-10T00:00:00Z',
    }))

    const res = runStudySimulation({
      track: sampleTrack,
      studySessions: sampleSessions,
      examLogs: sampleExams,
      reviewItems: overdueReviews,
      asOfDate: '2026-11-22',
    })
    expect(res.status).toBe('ready')
    if (res.status === 'ready') {
      expect(res.retentionAlert.severity).toBe('critical')
      expect(res.retentionAlert.overdueReviewCount).toBe(9)
      expect(res.retentionAlert.retentionPenaltyPct).toBeGreaterThan(0)
    }
  })

  it('computes Ebbinghaus review intervals accurately for again, hard, and good', () => {
    expect(computeNextReviewSchedule(3, 'again', '2026-11-22')).toEqual({
      stage: 0,
      nextReviewDate: '2026-11-23',
      status: 'active',
    })

    expect(computeNextReviewSchedule(2, 'hard', '2026-11-22')).toEqual({
      stage: 2,
      nextReviewDate: '2026-11-25', // floor(7 / 2) = 3 days
      status: 'active',
    })

    expect(computeNextReviewSchedule(0, 'good', '2026-11-22')).toEqual({
      stage: 1,
      nextReviewDate: '2026-11-25', // STAGE_INTERVAL_DAYS[1] = 3 days
      status: 'active',
    })

    expect(computeNextReviewSchedule(5, 'good', '2026-11-22')).toEqual({
      stage: 5,
      nextReviewDate: '2027-01-21', // +60 days
      status: 'mastered',
    })
  })
})
