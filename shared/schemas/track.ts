import { z } from 'zod'

export const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
export const TRACK_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/

export const TrackCategorySchema = z.enum([
  'certification',
  'programming',
  'language',
  'general',
])

export type TrackCategory = z.infer<typeof TrackCategorySchema>

export const StudyTrackInputSchema = z.strictObject({
  id: z.string().regex(TRACK_ID_REGEX, 'トラックIDは半角英数字・ハイフン・アンダースコア（64文字以内）で指定してください').optional(),
  title: z.string().trim().min(1, '学習テーマ名を入力してください').max(100),
  category: TrackCategorySchema,
  targetDate: z.string().regex(ISO_DATE_REGEX, '目標日は YYYY-MM-DD 形式で入力してください'),
  targetScorePct: z.number().min(0).max(100),
  passingScorePct: z.number().min(0).max(100).default(70),
  targetTotalHours: z.number().min(1).max(10000),
  dailyGoalMinutes: z.number().int().min(10).max(720),
  isDefault: z.boolean().default(false),
})

export type StudyTrackInput = z.infer<typeof StudyTrackInputSchema>

export const StudyTrackSchema = z.strictObject({
  id: z.string().regex(TRACK_ID_REGEX),
  title: z.string().min(1).max(100),
  category: TrackCategorySchema,
  targetDate: z.string().regex(ISO_DATE_REGEX),
  targetScorePct: z.number().min(0).max(100),
  passingScorePct: z.number().min(0).max(100),
  targetTotalHours: z.number().min(1).max(10000),
  dailyGoalMinutes: z.number().int().min(10).max(720),
  isDefault: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type StudyTrack = z.infer<typeof StudyTrackSchema>

export const TracksListResponseSchema = z.strictObject({
  tracks: z.array(StudyTrackSchema),
  maxTracks: z.number().int().positive(),
})

export type TracksListResponse = z.infer<typeof TracksListResponseSchema>

export const MAX_STUDY_TRACKS = 20
