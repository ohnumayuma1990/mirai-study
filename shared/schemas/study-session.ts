import { z } from 'zod'
import { ISO_DATE_REGEX, TRACK_ID_REGEX } from './track'

export const StudyCategorySchema = z.enum([
  'lecture',
  'practice',
  'coding',
  'review',
])

export type StudyCategory = z.infer<typeof StudyCategorySchema>

export const StudySessionInputSchema = z.strictObject({
  trackId: z.string().regex(TRACK_ID_REGEX, '有効なトラックIDを指定してください'),
  studiedDate: z.string().regex(ISO_DATE_REGEX, '学習日は YYYY-MM-DD 形式で入力してください'),
  durationMinutes: z.number().int().min(1, '学習時間は1分以上で入力してください').max(1440),
  materialOrTopic: z.string().trim().min(1, '教材・トピック名を入力してください').max(120),
  category: StudyCategorySchema,
  focusLevel: z.number().int().min(1).max(5),
  memo: z.string().trim().max(500).optional(),
  imagePath: z.string().trim().max(256).optional(),
})

export type StudySessionInput = z.infer<typeof StudySessionInputSchema>

export const StudySessionSchema = z.strictObject({
  id: z.string().min(1),
  trackId: z.string().regex(TRACK_ID_REGEX),
  studiedDate: z.string().regex(ISO_DATE_REGEX),
  durationMinutes: z.number().int().min(1).max(1440),
  materialOrTopic: z.string().min(1).max(120),
  category: StudyCategorySchema,
  focusLevel: z.number().int().min(1).max(5),
  memo: z.string().max(500).optional(),
  imagePath: z.string().max(256).optional(),
  createdAt: z.string(),
})

export type StudySession = z.infer<typeof StudySessionSchema>

export const StudySessionsQuerySchema = z.strictObject({
  trackId: z.string().regex(TRACK_ID_REGEX).optional(),
  limit: z.coerce.number().int().min(1).max(180).default(60),
})

export const StudySessionsListResponseSchema = z.strictObject({
  sessions: z.array(StudySessionSchema),
})

export type StudySessionsListResponse = z.infer<typeof StudySessionsListResponseSchema>
