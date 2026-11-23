import type { StudyTrack } from '../schemas/track'
import type { StudySession } from '../schemas/study-session'
import type { ExamLog } from '../schemas/exam-log'
import { STAGE_INTERVAL_DAYS, type ReviewGrade, type ReviewItem, type ReviewStatus } from '../schemas/review-item'
import {
  MAX_SIMULATION_DAYS,
  type RetentionAlert,
  type ScenarioSummary,
  type SimulationPoint,
  type SimulationResponse,
} from '../schemas/simulation'

const MS_PER_DAY = 86_400_000
const OBSERVED_WINDOW_DAYS = 30
const INTENSIVE_MULTIPLIER = 1.35
const BASE_SCORE_FLOOR = 20

export function parseIsoDateUtc(isoDate: string): number {
  const parts = isoDate.split('-').map(Number)
  const year = parts[0] ?? 1970
  const month = parts[1] ?? 1
  const day = parts[2] ?? 1
  return Date.UTC(year, month - 1, day)
}

export function formatIsoDateUtc(utcMs: number): string {
  const d = new Date(utcMs)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDaysIso(isoDate: string, days: number): string {
  return formatIsoDateUtc(parseIsoDateUtc(isoDate) + days * MS_PER_DAY)
}

export function diffDaysIso(fromIso: string, toIso: string): number {
  return Math.round((parseIsoDateUtc(toIso) - parseIsoDateUtc(fromIso)) / MS_PER_DAY)
}

export function todayIsoUtc(now: Date = new Date()): string {
  return formatIsoDateUtc(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Computes next review stage, nextReviewDate, and status based on Ebbinghaus spaced repetition.
 */
export function computeNextReviewSchedule(
  currentStage: number,
  grade: ReviewGrade,
  asOfDate: string,
): { stage: number; nextReviewDate: string; status: ReviewStatus } {
  const safeStage = clamp(Math.floor(currentStage), 0, STAGE_INTERVAL_DAYS.length - 1)

  if (grade === 'again') {
    return {
      stage: 0,
      nextReviewDate: addDaysIso(asOfDate, 1),
      status: 'active',
    }
  }

  if (grade === 'hard') {
    const currentInterval = STAGE_INTERVAL_DAYS[safeStage] ?? 1
    const halfInterval = Math.max(1, Math.floor(currentInterval / 2))
    return {
      stage: safeStage,
      nextReviewDate: addDaysIso(asOfDate, halfInterval),
      status: 'active',
    }
  }

  // grade === 'good'
  if (safeStage >= STAGE_INTERVAL_DAYS.length - 1) {
    return {
      stage: STAGE_INTERVAL_DAYS.length - 1,
      nextReviewDate: addDaysIso(asOfDate, STAGE_INTERVAL_DAYS[STAGE_INTERVAL_DAYS.length - 1]),
      status: 'mastered',
    }
  }

  const nextStage = safeStage + 1
  const nextInterval = STAGE_INTERVAL_DAYS[nextStage] ?? 60
  return {
    stage: nextStage,
    nextReviewDate: addDaysIso(asOfDate, nextInterval),
    status: 'active',
  }
}

/**
 * Simple OLS slope (percentage points per day) over chronological exam logs.
 */
export function computeExamOlsSlopePerDay(examLogs: ExamLog[]): number | null {
  if (examLogs.length < 2) {
    return null
  }
  const sorted = [...examLogs].sort((a, b) => a.takenDate.localeCompare(b.takenDate))
  const baseMs = parseIsoDateUtc(sorted[0]!.takenDate)
  const xs = sorted.map((log) => (parseIsoDateUtc(log.takenDate) - baseMs) / MS_PER_DAY)
  const ys = sorted.map((log) => log.scorePct)

  const n = xs.length
  const meanX = xs.reduce((acc, x) => acc + x, 0) / n
  const meanY = ys.reduce((acc, y) => acc + y, 0) / n

  let num = 0
  let den = 0
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - meanX
    const dy = ys[i]! - meanY
    num += dx * dy
    den += dx * dx
  }

  if (den <= 0) {
    return null
  }
  return num / den
}

export function computeRetentionAlert(overdueReviewCount: number): RetentionAlert {
  const safeCount = Math.max(0, Math.floor(overdueReviewCount))
  if (safeCount === 0) {
    return {
      overdueReviewCount: 0,
      retentionPenaltyPct: 0,
      recommendedReviewsToday: 0,
      severity: 'none',
      message: '期限切れの復習アイテムはありません。良好な定着ペースを維持しています。',
    }
  }

  const penaltyPct = round1(Math.min(18, safeCount * 1.2))
  const recommended = Math.min(safeCount, 10)
  const severity = safeCount >= 8 ? 'critical' : 'warning'
  const message =
    severity === 'critical'
      ? `期限切れの復習が ${safeCount} 件溜まっています（実効定着率 -${penaltyPct}%）。まずは今日 ${recommended} 件を優先消化しましょう。`
      : `期限切れの復習が ${safeCount} 件あります（実効定着率 -${penaltyPct}%）。今日中に ${recommended} 件の復習をおすすめします。`

  return {
    overdueReviewCount: safeCount,
    retentionPenaltyPct: penaltyPct,
    recommendedReviewsToday: recommended,
    severity,
    message,
  }
}

/**
 * Projects score using diminishing returns (logistic-like saturation) plus forgetting decay.
 */
function advanceScoreOneDay(params: {
  currentScore: number
  dailyHours: number
  targetTotalHours: number
  targetScorePct: number
  observedOlsBonusPerDay: number
  forgettingDecayPerDay: number
  retentionMultiplier: number
}): number {
  const {
    currentScore,
    dailyHours,
    targetTotalHours,
    targetScorePct,
    observedOlsBonusPerDay,
    forgettingDecayPerDay,
    retentionMultiplier,
  } = params

  // Diminishing returns: as score approaches 100%, marginal gain per hour tapers off.
  const headroom = Math.max(0, 100 - currentScore) / 100
  const baseGainPerHour = Math.max(0.15, (targetScorePct - BASE_SCORE_FLOOR) / Math.max(10, targetTotalHours))
  const diminishingFactor = 0.35 + 1.15 * Math.pow(headroom, 0.85)
  const studyGain = dailyHours * baseGainPerHour * diminishingFactor * retentionMultiplier
  const trendContribution = observedOlsBonusPerDay * Math.max(0.2, headroom)
  const decay = currentScore > BASE_SCORE_FLOOR ? forgettingDecayPerDay * (currentScore / 100) : 0

  return clamp(currentScore + studyGain + trendContribution - decay, 0, 100)
}

export interface RunStudySimulationInput {
  track: StudyTrack | null
  studySessions: StudySession[]
  examLogs: ExamLog[]
  reviewItems: ReviewItem[]
  asOfDate?: string
  dailyMinutesOverride?: number
}

export function runStudySimulation(input: RunStudySimulationInput): SimulationResponse {
  const asOfDate = input.asOfDate ?? todayIsoUtc()

  if (!input.track) {
    return {
      status: 'needs_setup',
      trackId: null,
      missing: ['study_track'],
      message: '学習トラックが未設定です。まずは資格試験または技術習得の目標トラックを作成してください。',
    }
  }

  const track = input.track
  const trackSessions = input.studySessions.filter((s) => s.trackId === track.id)
  const trackExams = input.examLogs.filter((e) => e.trackId === track.id)
  const trackReviews = input.reviewItems.filter((r) => r.trackId === track.id && r.status === 'active')

  if (trackSessions.length === 0 && trackExams.length === 0) {
    return {
      status: 'needs_setup',
      trackId: track.id,
      missing: ['study_sessions_or_exam_logs'],
      message: '未来予測を開始するには、学習セッションまたは演習・模試ログを1件以上記録してください。',
    }
  }

  const totalMinutes = trackSessions.reduce((acc, s) => acc + s.durationMinutes, 0)
  const cumulativeStudyHours = round1(totalMinutes / 60)

  // Observed daily minutes over recent window (up to 30 days)
  const windowStartIso = addDaysIso(asOfDate, -OBSERVED_WINDOW_DAYS)
  const recentSessions = trackSessions.filter((s) => s.studiedDate >= windowStartIso && s.studiedDate <= asOfDate)
  let observedDailyMinutesAvg = 0
  if (recentSessions.length > 0) {
    const earliestRecent = recentSessions.reduce(
      (min, s) => (s.studiedDate < min ? s.studiedDate : min),
      recentSessions[0]!.studiedDate,
    )
    const spanDays = clamp(diffDaysIso(earliestRecent, asOfDate) + 1, 1, OBSERVED_WINDOW_DAYS)
    const recentMinutes = recentSessions.reduce((acc, s) => acc + s.durationMinutes, 0)
    observedDailyMinutesAvg = round1(recentMinutes / spanDays)
  } else if (trackSessions.length > 0) {
    const earliest = trackSessions.reduce(
      (min, s) => (s.studiedDate < min ? s.studiedDate : min),
      trackSessions[0]!.studiedDate,
    )
    const spanDays = clamp(diffDaysIso(earliest, asOfDate) + 1, 1, 90)
    observedDailyMinutesAvg = round1(totalMinutes / spanDays)
  }

  // Current estimated score: weighted recent exams or hour-based estimate if only sessions exist
  const sortedExams = [...trackExams].sort((a, b) => a.takenDate.localeCompare(b.takenDate))
  let currentEstimatedScorePct: number
  if (sortedExams.length > 0) {
    const recentExams = sortedExams.slice(-3)
    const weightSum = recentExams.reduce((acc, _, idx) => acc + (idx + 1), 0)
    const weightedAvg = recentExams.reduce((acc, exam, idx) => acc + exam.scorePct * (idx + 1), 0) / weightSum
    currentEstimatedScorePct = round1(clamp(weightedAvg, 0, 100))
  } else {
    const progressRatio = clamp(cumulativeStudyHours / Math.max(1, track.targetTotalHours), 0, 1)
    currentEstimatedScorePct = round1(
      clamp(BASE_SCORE_FLOOR + (track.targetScorePct - BASE_SCORE_FLOOR) * Math.pow(progressRatio, 0.75), 0, 95),
    )
  }

  // Due & overdue reviews
  const dueReviewCount = trackReviews.filter((r) => r.nextReviewDate <= asOfDate).length
  const overdueReviewCount = trackReviews.filter((r) => r.nextReviewDate < asOfDate).length
  const retentionAlert = computeRetentionAlert(overdueReviewCount)

  // Effective daily goal minutes (supports slider What-If override)
  const effectiveDailyGoalMinutes = clamp(
    input.dailyMinutesOverride ?? track.dailyGoalMinutes,
    10,
    720,
  )
  const intensiveDailyMinutes = Math.min(720, Math.round(effectiveDailyGoalMinutes * INTENSIVE_MULTIPLIER))

  // OLS trend slope (clamped to avoid extreme extrapolation)
  const rawSlope = computeExamOlsSlopePerDay(sortedExams)
  const observedOlsBonusPerDay = rawSlope === null ? 0 : clamp(rawSlope * 0.25, -0.35, 0.5)

  const rawDaysRemaining = diffDaysIso(asOfDate, track.targetDate)
  const horizonDays = clamp(Math.max(14, rawDaysRemaining), 1, MAX_SIMULATION_DAYS)
  const targetDayIndex = clamp(rawDaysRemaining, 0, horizonDays)

  // Effective starting score reflects slight retention drag for observed trend
  let obsScore = clamp(currentEstimatedScorePct - retentionAlert.retentionPenaltyPct * 0.25, 0, 100)
  let tgtScore = currentEstimatedScorePct
  let intScore = currentEstimatedScorePct

  let obsHours = cumulativeStudyHours
  let tgtHours = cumulativeStudyHours
  let intHours = cumulativeStudyHours

  const obsDailyHours = observedDailyMinutesAvg / 60
  const tgtDailyHours = effectiveDailyGoalMinutes / 60
  const intDailyHours = intensiveDailyMinutes / 60

  const obsForgettingDecay = 0.08 + retentionAlert.retentionPenaltyPct * 0.015
  const tgtForgettingDecay = 0.05
  const intForgettingDecay = 0.02

  let obsPassDate: string | null = obsScore >= track.passingScorePct ? asOfDate : null
  let tgtPassDate: string | null = tgtScore >= track.passingScorePct ? asOfDate : null
  let intPassDate: string | null = intScore >= track.passingScorePct ? asOfDate : null

  const points: SimulationPoint[] = []

  for (let day = 0; day <= horizonDays; day += 1) {
    const date = addDaysIso(asOfDate, day)
    if (day > 0) {
      obsHours += obsDailyHours
      tgtHours += tgtDailyHours
      intHours += intDailyHours

      obsScore = advanceScoreOneDay({
        currentScore: obsScore,
        dailyHours: obsDailyHours,
        targetTotalHours: track.targetTotalHours,
        targetScorePct: track.targetScorePct,
        observedOlsBonusPerDay,
        forgettingDecayPerDay: obsForgettingDecay,
        retentionMultiplier: 1.0,
      })

      tgtScore = advanceScoreOneDay({
        currentScore: tgtScore,
        dailyHours: tgtDailyHours,
        targetTotalHours: track.targetTotalHours,
        targetScorePct: track.targetScorePct,
        observedOlsBonusPerDay: Math.max(0, observedOlsBonusPerDay * 0.5),
        forgettingDecayPerDay: tgtForgettingDecay,
        retentionMultiplier: 1.05,
      })

      intScore = advanceScoreOneDay({
        currentScore: intScore,
        dailyHours: intDailyHours,
        targetTotalHours: track.targetTotalHours,
        targetScorePct: track.targetScorePct,
        observedOlsBonusPerDay: Math.max(0, observedOlsBonusPerDay * 0.6),
        forgettingDecayPerDay: intForgettingDecay,
        retentionMultiplier: 1.18,
      })

      if (obsPassDate === null && obsScore >= track.passingScorePct) {
        obsPassDate = date
      }
      if (tgtPassDate === null && tgtScore >= track.passingScorePct) {
        tgtPassDate = date
      }
      if (intPassDate === null && intScore >= track.passingScorePct) {
        intPassDate = date
      }
    }

    points.push({
      date,
      observedScorePct: round1(obsScore),
      targetScorePct: round1(tgtScore),
      intensiveScorePct: round1(intScore),
      observedCumulativeHours: round1(obsHours),
      targetCumulativeHours: round1(tgtHours),
      intensiveCumulativeHours: round1(intHours),
    })
  }

  const targetPoint = points[targetDayIndex] ?? points[points.length - 1]!

  const buildScenarioSummary = (
    scenario: ScenarioSummary['scenario'],
    label: string,
    dailyMinutes: number,
    projectedScore: number,
    projectedHours: number,
    passDate: string | null,
  ): ScenarioSummary => ({
    scenario,
    label,
    dailyMinutes: round1(dailyMinutes),
    projectedScoreAtTargetDate: projectedScore,
    projectedHoursAtTargetDate: projectedHours,
    willPass: projectedScore >= track.passingScorePct,
    estimatedPassDate: passDate,
  })

  return {
    status: 'ready',
    trackId: track.id,
    trackTitle: track.title,
    asOfDate,
    targetDate: track.targetDate,
    daysRemaining: rawDaysRemaining,
    passingScorePct: track.passingScorePct,
    targetScorePct: track.targetScorePct,
    targetTotalHours: track.targetTotalHours,
    cumulativeStudyHours,
    currentEstimatedScorePct,
    observedDailyMinutesAvg,
    effectiveDailyGoalMinutes,
    dueReviewCount,
    retentionAlert,
    scenarios: {
      observed_trend: buildScenarioSummary(
        'observed_trend',
        '現状トレンド',
        observedDailyMinutesAvg,
        targetPoint.observedScorePct,
        targetPoint.observedCumulativeHours,
        obsPassDate,
      ),
      target_pace: buildScenarioSummary(
        'target_pace',
        '目標ペース',
        effectiveDailyGoalMinutes,
        targetPoint.targetScorePct,
        targetPoint.targetCumulativeHours,
        tgtPassDate,
      ),
      intensive_pace: buildScenarioSummary(
        'intensive_pace',
        '集中＋復習ペース',
        intensiveDailyMinutes,
        targetPoint.intensiveScorePct,
        targetPoint.intensiveCumulativeHours,
        intPassDate,
      ),
    },
    points,
  }
}
