import { z } from 'zod'
import { ISO_DATE_REGEX, TRACK_ID_REGEX } from './track'

export const ExamLogInputSchema = z.strictObject({
  trackId: z.string().regex(TRACK_ID_REGEX, '有効なトラックIDを指定してください'),
  takenDate: z.string().regex(ISO_DATE_REGEX, '受験日は YYYY-MM-DD 形式で入力してください'),
  examName: z.string().trim().min(1, '模試・演習名を入力してください').max(120),
  scorePct: z.number().min(0).max(100),
  correctCount: z.number().int().min(0).max(10000).optional(),
  totalQuestions: z.number().int().min(1).max(10000).optional(),
  domainArea: z.string().trim().max(100).optional(),
  weakTopics: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  memo: z.string().trim().max(500).optional(),
  imagePath: z.string().trim().max(256).optional(),
}).refine(
  (val) => {
    if (val.correctCount !== undefined && val.totalQuestions !== undefined) {
      return val.correctCount <= val.totalQuestions
    }
    return true
  },
  { message: '正答数は問題数以下である必要があります', path: ['correctCount'] },
)

export type ExamLogInput = z.infer<typeof ExamLogInputSchema>

export const ExamLogSchema = z.strictObject({
  id: z.string().min(1),
  trackId: z.string().regex(TRACK_ID_REGEX),
  takenDate: z.string().regex(ISO_DATE_REGEX),
  examName: z.string().min(1).max(120),
  scorePct: z.number().min(0).max(100),
  correctCount: z.number().int().min(0).max(10000).optional(),
  totalQuestions: z.number().int().min(1).max(10000).optional(),
  domainArea: z.string().max(100).optional(),
  weakTopics: z.array(z.string().max(60)).max(20),
  memo: z.string().max(500).optional(),
  imagePath: z.string().max(256).optional(),
  createdAt: z.string(),
})

export type ExamLog = z.infer<typeof ExamLogSchema>

export const ExamLogsQuerySchema = z.strictObject({
  trackId: z.string().regex(TRACK_ID_REGEX).optional(),
  limit: z.coerce.number().int().min(1).max(180).default(60),
})

export const ExamLogsListResponseSchema = z.strictObject({
  logs: z.array(ExamLogSchema),
})

export type ExamLogsListResponse = z.infer<typeof ExamLogsListResponseSchema>
