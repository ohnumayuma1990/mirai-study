import { z } from 'zod'
import { ISO_DATE_REGEX, TRACK_ID_REGEX } from './track'
import { StudyCategorySchema } from './study-session'

export const VisionIngestTypeSchema = z.enum([
  'exam_result_ocr',
  'study_material_photo',
  'study_timer_ocr',
])

export type VisionIngestType = z.infer<typeof VisionIngestTypeSchema>

export const VisionReviewCardDraftSchema = z.strictObject({
  topic: z.string().min(1).max(120),
  questionOrPrompt: z.string().min(1).max(500),
  answerOrNote: z.string().min(1).max(1000),
})

export type VisionReviewCardDraft = z.infer<typeof VisionReviewCardDraftSchema>

export const ExamResultOcrOutputSchema = z.strictObject({
  ingestType: z.literal('exam_result_ocr'),
  examName: z.string().min(1).max(120),
  takenDate: z.string().regex(ISO_DATE_REGEX).nullable(),
  scorePct: z.number().min(0).max(100),
  correctCount: z.number().int().min(0).max(10000).nullable(),
  totalQuestions: z.number().int().min(1).max(10000).nullable(),
  domainArea: z.string().max(100).nullable(),
  weakTopics: z.array(z.string().min(1).max(60)).max(10),
  reviewCards: z.array(VisionReviewCardDraftSchema).max(5),
  confidence: z.number().min(0).max(1),
  summary: z.string().max(500),
})

export const StudyMaterialPhotoOutputSchema = z.strictObject({
  ingestType: z.literal('study_material_photo'),
  materialOrTopic: z.string().min(1).max(120),
  category: StudyCategorySchema,
  estimatedDurationMinutes: z.number().int().min(1).max(600).nullable(),
  keySummary: z.string().min(1).max(500),
  reviewCards: z.array(VisionReviewCardDraftSchema).max(8),
  confidence: z.number().min(0).max(1),
})

export const StudyTimerOcrOutputSchema = z.strictObject({
  ingestType: z.literal('study_timer_ocr'),
  studiedDate: z.string().regex(ISO_DATE_REGEX).nullable(),
  durationMinutes: z.number().int().min(1).max(1440),
  materialOrTopic: z.string().min(1).max(120),
  category: StudyCategorySchema,
  focusLevel: z.number().int().min(1).max(5),
  summary: z.string().max(500),
  confidence: z.number().min(0).max(1),
})

export const VisionAnalysisResultSchema = z.discriminatedUnion('ingestType', [
  ExamResultOcrOutputSchema,
  StudyMaterialPhotoOutputSchema,
  StudyTimerOcrOutputSchema,
])

export type ExamResultOcrOutput = z.infer<typeof ExamResultOcrOutputSchema>
export type StudyMaterialPhotoOutput = z.infer<typeof StudyMaterialPhotoOutputSchema>
export type StudyTimerOcrOutput = z.infer<typeof StudyTimerOcrOutputSchema>
export type VisionAnalysisResult = z.infer<typeof VisionAnalysisResultSchema>

export const VisionIngestResponseSchema = z.strictObject({
  imagePath: z.string().min(1).max(256),
  trackId: z.string().regex(TRACK_ID_REGEX).nullable(),
  analysis: VisionAnalysisResultSchema,
})

export type VisionIngestResponse = z.infer<typeof VisionIngestResponseSchema>

export const DeleteUploadBodySchema = z.strictObject({
  imagePath: z.string().min(1).max(256),
})
