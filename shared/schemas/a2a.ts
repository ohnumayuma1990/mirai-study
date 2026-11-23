import { z } from 'zod'

export const A2A_AGENT_ID = 'miraistudy' as const
export const A2A_AUDIENCE = 'a2a:miraistudy' as const
export const A2A_PROTOCOL_VERSION = '1.0' as const

export const A2A_EXTENSION_QUICKSHEET = 'urn:roza:quicksheet:v1' as const
export const A2A_EXTENSION_UI_CARDS = 'urn:roza:ui-cards:v1' as const
export const A2A_EXTENSION_HITL_FORM = 'urn:roza:hitl-form:v1' as const

export const A2aQuickSheetTabSchema = z.enum([
  'simulation',
  'study_sessions',
  'exam_logs',
  'reviews_and_dev',
])

export type A2aQuickSheetTab = z.infer<typeof A2aQuickSheetTabSchema>

export const A2aRecordKindSchema = z.enum([
  'study_session',
  'exam_log',
  'dev_log',
  'review_item',
])

export type A2aRecordKind = z.infer<typeof A2aRecordKindSchema>

export const A2aMessagePartSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('text'),
    text: z.string().max(4000),
  }),
  z.strictObject({
    kind: z.literal('data'),
    data: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({
    kind: z.literal('file'),
    file: z.strictObject({
      mimeType: z.string().min(1).max(100),
      bytes: z.string().min(1).max(6_000_000),
      name: z.string().max(200).optional(),
    }),
  }),
])

export type A2aMessagePart = z.infer<typeof A2aMessagePartSchema>

export const A2aJsonRpcRequestSchema = z.strictObject({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string().min(1).max(128), z.number().int()]),
  method: z.enum([
    'message/send',
    'tasks/get',
    'tasks/cancel',
    'quicksheet/get',
  ]),
  params: z.record(z.string(), z.unknown()).default({}),
})

export type A2aJsonRpcRequest = z.infer<typeof A2aJsonRpcRequestSchema>

export const A2aTaskCommitBodySchema = z.strictObject({
  recordKind: A2aRecordKindSchema,
  payload: z.record(z.string(), z.unknown()),
})

export type A2aTaskCommitBody = z.infer<typeof A2aTaskCommitBodySchema>

export const A2aTaskStatusSchema = z.enum([
  'input-required',
  'completed',
  'canceled',
  'failed',
])

export type A2aTaskStatus = z.infer<typeof A2aTaskStatusSchema>

export const A2aDraftTaskSchema = z.strictObject({
  taskId: z.string().min(1),
  uid: z.string().min(1),
  recordKind: A2aRecordKindSchema,
  status: A2aTaskStatusSchema,
  draft: z.record(z.string(), z.unknown()),
  stagingImagePath: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type A2aDraftTask = z.infer<typeof A2aDraftTaskSchema>
