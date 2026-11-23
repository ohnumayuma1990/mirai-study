import { z } from 'zod'
import { ISO_DATE_REGEX, TRACK_ID_REGEX } from './track'

export const MAX_SIMULATION_DAYS = 730

export const SimulationQuerySchema = z.strictObject({
  trackId: z.string().regex(TRACK_ID_REGEX).optional(),
  dailyMinutesOverride: z.coerce.number().int().min(10).max(720).optional(),
})

export type SimulationQuery = z.infer<typeof SimulationQuerySchema>

export const SimulationPointSchema = z.strictObject({
  date: z.string().regex(ISO_DATE_REGEX),
  observedScorePct: z.number().min(0).max(100),
  targetScorePct: z.number().min(0).max(100),
  intensiveScorePct: z.number().min(0).max(100),
  observedCumulativeHours: z.number().min(0),
  targetCumulativeHours: z.number().min(0),
  intensiveCumulativeHours: z.number().min(0),
})

export type SimulationPoint = z.infer<typeof SimulationPointSchema>

export const ScenarioSummarySchema = z.strictObject({
  scenario: z.enum(['observed_trend', 'target_pace', 'intensive_pace']),
  label: z.string(),
  dailyMinutes: z.number().min(0),
  projectedScoreAtTargetDate: z.number().min(0).max(100),
  projectedHoursAtTargetDate: z.number().min(0),
  willPass: z.boolean(),
  estimatedPassDate: z.string().regex(ISO_DATE_REGEX).nullable(),
})

export type ScenarioSummary = z.infer<typeof ScenarioSummarySchema>

export const RetentionAlertSchema = z.strictObject({
  overdueReviewCount: z.number().int().min(0),
  retentionPenaltyPct: z.number().min(0).max(30),
  recommendedReviewsToday: z.number().int().min(0),
  severity: z.enum(['none', 'warning', 'critical']),
  message: z.string(),
})

export type RetentionAlert = z.infer<typeof RetentionAlertSchema>

export const SimulationNeedsSetupResponseSchema = z.strictObject({
  status: z.literal('needs_setup'),
  trackId: z.string().nullable(),
  missing: z.array(z.string().min(1)),
  message: z.string(),
})

export const SimulationReadyResponseSchema = z.strictObject({
  status: z.literal('ready'),
  trackId: z.string().regex(TRACK_ID_REGEX),
  trackTitle: z.string(),
  asOfDate: z.string().regex(ISO_DATE_REGEX),
  targetDate: z.string().regex(ISO_DATE_REGEX),
  daysRemaining: z.number().int(),
  passingScorePct: z.number().min(0).max(100),
  targetScorePct: z.number().min(0).max(100),
  targetTotalHours: z.number().min(1),
  cumulativeStudyHours: z.number().min(0),
  currentEstimatedScorePct: z.number().min(0).max(100),
  observedDailyMinutesAvg: z.number().min(0),
  effectiveDailyGoalMinutes: z.number().min(10).max(720),
  dueReviewCount: z.number().int().min(0),
  retentionAlert: RetentionAlertSchema,
  scenarios: z.strictObject({
    observed_trend: ScenarioSummarySchema,
    target_pace: ScenarioSummarySchema,
    intensive_pace: ScenarioSummarySchema,
  }),
  points: z.array(SimulationPointSchema),
})

export const SimulationResponseSchema = z.discriminatedUnion('status', [
  SimulationNeedsSetupResponseSchema,
  SimulationReadyResponseSchema,
])

export type SimulationNeedsSetupResponse = z.infer<typeof SimulationNeedsSetupResponseSchema>
export type SimulationReadyResponse = z.infer<typeof SimulationReadyResponseSchema>
export type SimulationResponse = z.infer<typeof SimulationResponseSchema>
