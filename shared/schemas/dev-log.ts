import { z } from 'zod'
import { ISO_DATE_REGEX, TRACK_ID_REGEX } from './track'

export const DevLogInputSchema = z.strictObject({
  trackId: z.string().regex(TRACK_ID_REGEX, '有効なトラックIDを指定してください'),
  loggedDate: z.string().regex(ISO_DATE_REGEX, '記録日は YYYY-MM-DD 形式で入力してください'),
  featureSummary: z.string().trim().min(1, '実装機能・成果物を入力してください').max(150),
  completedTasks: z.number().int().min(0).max(500).default(1),
  handsOnMinutes: z.number().int().min(0).max(1440),
  tags: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
  commitOrArtifactNote: z.string().trim().max(500).optional(),
})

export type DevLogInput = z.infer<typeof DevLogInputSchema>

export const DevLogSchema = z.strictObject({
  id: z.string().min(1),
  trackId: z.string().regex(TRACK_ID_REGEX),
  loggedDate: z.string().regex(ISO_DATE_REGEX),
  featureSummary: z.string().min(1).max(150),
  completedTasks: z.number().int().min(0).max(500),
  handsOnMinutes: z.number().int().min(0).max(1440),
  tags: z.array(z.string().max(40)).max(15),
  commitOrArtifactNote: z.string().max(500).optional(),
  createdAt: z.string(),
})

export type DevLog = z.infer<typeof DevLogSchema>

export const DevLogsQuerySchema = z.strictObject({
  trackId: z.string().regex(TRACK_ID_REGEX).optional(),
  limit: z.coerce.number().int().min(1).max(180).default(60),
})

export const DevLogsListResponseSchema = z.strictObject({
  logs: z.array(DevLogSchema),
})

export type DevLogsListResponse = z.infer<typeof DevLogsListResponseSchema>
