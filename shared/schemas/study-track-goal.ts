import { z } from 'zod'
import { TrackCategorySchema } from './track'

export const A2A_STUDY_TRACK_SKILL = 'study_track_goal'
export const A2A_EXTENSION_STUDY_TRACK = 'urn:roza:study-track-goals:v1'

export const StudyTrackGoalTurnSchema = z.object({
  studyTrackGoal: z.enum(['start', 'continue']),
  history: z.array(z.strictObject({
    role: z.enum(['user', 'agent']),
    text: z.string().trim().min(1).max(1000),
  })).max(10),
})
export type StudyTrackGoalTurn = z.infer<typeof StudyTrackGoalTurnSchema>

export const StudyTrackGoalTaskIdSchema = z.uuid()
export const StudyTrackGoalConfirmSchema = z.strictObject({
  editedFields: z.strictObject({
    title: z.string().max(200).optional(),
    category: TrackCategorySchema.optional(),
    targetDate: z.string().max(20).optional(),
    dailyGoalMinutes: z.number().nullable().optional(),
    targetTotalHours: z.number().nullable().optional(),
    targetScorePct: z.number().nullable().optional(),
    passingScorePct: z.number().nullable().optional(),
  }),
})
export type StudyTrackGoalEdits = z.infer<typeof StudyTrackGoalConfirmSchema>['editedFields']

export const StudyTrackGoalFieldKeySchema = z.enum([
  'category',
  'targetDate',
  'dailyGoalMinutes',
  'targetTotalHours',
  'targetScorePct',
  'passingScorePct',
])
export type StudyTrackGoalFieldKey = z.infer<typeof StudyTrackGoalFieldKeySchema>

export const StudyTrackGoalInterpretationSchema = z.strictObject({
  intent: z.enum(['create', 'update', 'clarify', 'summary', 'cancel']),
  trackNumber: z.number().int().nullable(),
  title: z.string().nullable(),
  category: TrackCategorySchema.nullable(),
  targetDate: z.string().nullable(),
  dailyGoalMinutes: z.number().int().nullable(),
  targetTotalHours: z.number().nullable(),
  targetScorePct: z.number().nullable(),
  passingScorePct: z.number().nullable(),
  scheduleNote: z.string().nullable(),
  question: z.string().nullable(),
  assumedFields: z.array(StudyTrackGoalFieldKeySchema),
})
