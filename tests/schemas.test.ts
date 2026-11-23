import { describe, expect, it } from 'vitest'
import { StudyTrackInputSchema } from '../shared/schemas/track'
import { StudySessionInputSchema } from '../shared/schemas/study-session'
import { ExamLogInputSchema } from '../shared/schemas/exam-log'
import { DevLogInputSchema } from '../shared/schemas/dev-log'
import { ReviewItemInputSchema } from '../shared/schemas/review-item'
import { ExamResultOcrOutputSchema } from '../shared/schemas/vision'

describe('shared/schemas strictObject contracts', () => {
  it('validates StudyTrackInput and rejects unknown keys', () => {
    const valid = StudyTrackInputSchema.safeParse({
      title: 'AWS SAA',
      category: 'certification',
      targetDate: '2027-03-31',
      targetScorePct: 80,
      passingScorePct: 72,
      targetTotalHours: 120,
      dailyGoalMinutes: 90,
      isDefault: true,
    })
    expect(valid.success).toBe(true)

    const extraKey = StudyTrackInputSchema.safeParse({
      title: 'AWS SAA',
      category: 'certification',
      targetDate: '2027-03-31',
      targetScorePct: 80,
      targetTotalHours: 120,
      dailyGoalMinutes: 90,
      unexpectedField: 'nope',
    })
    expect(extraKey.success).toBe(false)
  })

  it('rejects ExamLog when correctCount exceeds totalQuestions', () => {
    const invalid = ExamLogInputSchema.safeParse({
      trackId: 'aws-saa',
      takenDate: '2026-11-20',
      examName: 'Mock 1',
      scorePct: 85,
      correctCount: 70,
      totalQuestions: 65,
    })
    expect(invalid.success).toBe(false)
  })

  it('validates StudySession, DevLog, and ReviewItem inputs', () => {
    expect(
      StudySessionInputSchema.safeParse({
        trackId: 'ts-mastery',
        studiedDate: '2026-11-22',
        durationMinutes: 75,
        materialOrTopic: 'TypeScript Generics',
        category: 'coding',
        focusLevel: 5,
      }).success,
    ).toBe(true)

    expect(
      DevLogInputSchema.safeParse({
        trackId: 'ts-mastery',
        loggedDate: '2026-11-22',
        featureSummary: 'Implemented Zod v4 strict schemas',
        completedTasks: 3,
        handsOnMinutes: 90,
        tags: ['TypeScript', 'Zod'],
      }).success,
    ).toBe(true)

    expect(
      ReviewItemInputSchema.safeParse({
        trackId: 'aws-saa',
        topic: 'IAM Role',
        questionOrPrompt: 'STS AssumeRole の一時認証情報の主な利点は？',
        answerOrNote: '長期アクセスキーを埋め込まず最小権限を時限付与できる。',
      }).success,
    ).toBe(true)
  })

  it('validates Vision ExamResultOcrOutput strictly', () => {
    const res = ExamResultOcrOutputSchema.safeParse({
      ingestType: 'exam_result_ocr',
      examName: 'AWS SAA Practice #1',
      takenDate: '2026-11-22',
      scorePct: 76.5,
      correctCount: 50,
      totalQuestions: 65,
      domainArea: 'Networking',
      weakTopics: ['Transit Gateway'],
      reviewCards: [
        {
          topic: 'Transit Gateway',
          questionOrPrompt: 'VPCピアリングとの違いは？',
          answerOrNote: 'ハブ＆スポーク構成で推移的ルーティングが可能。',
        },
      ],
      confidence: 0.92,
      summary: '合格基準を上回る結果でした。',
    })
    expect(res.success).toBe(true)
  })
})
