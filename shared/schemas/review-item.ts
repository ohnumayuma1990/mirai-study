import { z } from 'zod'
import { ISO_DATE_REGEX, TRACK_ID_REGEX } from './track'

export const STAGE_INTERVAL_DAYS = [1, 3, 7, 14, 30, 60] as const

export const ReviewStatusSchema = z.enum(['active', 'mastered'])
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>

export const ReviewGradeSchema = z.enum(['again', 'hard', 'good'])
export type ReviewGrade = z.infer<typeof ReviewGradeSchema>

export const ReviewItemInputSchema = z.strictObject({
  trackId: z.string().regex(TRACK_ID_REGEX, '有効なトラックIDを指定してください'),
  topic: z.string().trim().min(1, '論点・単元名を入力してください').max(120),
  questionOrPrompt: z.string().trim().min(1, '確認ポイントを入力してください').max(500),
  answerOrNote: z.string().trim().min(1, '要点メモを入力してください').max(1000),
  nextReviewDate: z.string().regex(ISO_DATE_REGEX).optional(),
})

export type ReviewItemInput = z.infer<typeof ReviewItemInputSchema>

export const ReviewItemBatchInputSchema = z.strictObject({
  items: z.array(ReviewItemInputSchema).min(1).max(20),
})

export const ReviewItemSchema = z.strictObject({
  id: z.string().min(1),
  trackId: z.string().regex(TRACK_ID_REGEX),
  topic: z.string().min(1).max(120),
  questionOrPrompt: z.string().min(1).max(500),
  answerOrNote: z.string().min(1).max(1000),
  stage: z.number().int().min(0).max(5),
  nextReviewDate: z.string().regex(ISO_DATE_REGEX),
  lastReviewedAt: z.string().nullable(),
  status: ReviewStatusSchema,
  createdAt: z.string(),
})

export type ReviewItem = z.infer<typeof ReviewItemSchema>

export const ReviewGradeInputSchema = z.strictObject({
  id: z.string().min(1).max(128),
  grade: ReviewGradeSchema,
})

export type ReviewGradeInput = z.infer<typeof ReviewGradeInputSchema>

export const ReviewGradeBodySchema = z.strictObject({
  grade: ReviewGradeSchema,
})

export const ReviewsQuerySchema = z.strictObject({
  trackId: z.string().regex(TRACK_ID_REGEX).optional(),
  status: ReviewStatusSchema.optional(),
  dueOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

export const ReviewsListResponseSchema = z.strictObject({
  items: z.array(ReviewItemSchema),
  dueCount: z.number().int().min(0),
})

export type ReviewsListResponse = z.infer<typeof ReviewsListResponseSchema>
