import { z } from 'zod'

export const A2A_AGENT_ID = 'miraistudy' as const
export const A2A_AUDIENCE = 'a2a:miraistudy' as const
export const A2A_PROTOCOL_VERSION = '1.0' as const

export const A2A_EXTENSION_QUICKSHEET = 'urn:roza:quick-sheet:v1' as const
export const A2A_EXTENSION_UI_CARDS = 'urn:roza:ui-cards:v1' as const
export const A2A_EXTENSION_HITL_FORM = 'urn:roza:hitl-form:v1' as const

export const A2aScopeSchema = z.enum(['read', 'write'])
export type A2aScope = z.infer<typeof A2aScopeSchema>

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

export const A2aV1PartSchema = z.union([
  z.strictObject({
    text: z.string().max(4000),
  }),
  z.strictObject({
    data: z.record(z.string(), z.unknown()),
  }),
  A2aMessagePartSchema,
])

export type A2aV1Part = z.infer<typeof A2aV1PartSchema>

export const A2aSendMessageParamsSchema = z.strictObject({
  message: z.strictObject({
    role: z.literal('ROLE_USER'),
    messageId: z.string().min(1).max(128),
    parts: z.array(A2aV1PartSchema).min(1).max(20),
    taskId: z.string().min(1).max(128).optional(),
  }),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type A2aSendMessageParams = z.infer<typeof A2aSendMessageParamsSchema>

export const A2aJsonRpcRequestSchema = z.strictObject({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string().min(1).max(128), z.number().int()]),
  method: z.enum([
    'SendMessage',
    'CancelTask',
    'message/send',
    'tasks/get',
    'tasks/cancel',
    'quicksheet/get',
  ]),
  params: z.record(z.string(), z.unknown()).default({}),
})

export type A2aJsonRpcRequest = z.infer<typeof A2aJsonRpcRequestSchema>

export const A2aAgentCardInterfaceSchema = z.strictObject({
  url: z.string().url(),
  protocolBinding: z.literal('JSONRPC'),
  protocolVersion: z.literal('1.0'),
})

export const A2aAgentCardSchema = z.strictObject({
  id: z.literal(A2A_AGENT_ID),
  name: z.string().min(1).max(1000),
  description: z.string().min(1).max(2000),
  protocolVersion: z.literal(A2A_PROTOCOL_VERSION),
  supportedInterfaces: z.array(A2aAgentCardInterfaceSchema).min(1).max(10),
  capabilities: z.strictObject({
    streaming: z.literal(false),
    pushNotifications: z.literal(false),
    extensions: z.array(z.strictObject({ uri: z.string() })).optional(),
  }),
  skills: z.array(
    z.strictObject({
      id: z.string().min(1).max(128),
      name: z.string().min(1).max(200),
      description: z.string().min(1).max(1000),
    }),
  ).min(1).max(100),
})

export type A2aAgentCard = z.infer<typeof A2aAgentCardSchema>

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
