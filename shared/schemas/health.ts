import { z } from 'zod'

export const HealthResponseSchema = z.strictObject({
  status: z.enum(['ok', 'degraded']),
  service: z.literal('mirai-study'),
  timestamp: z.string(),
  checks: z.strictObject({
    firebaseAdminConfigured: z.boolean(),
    gcsConfigured: z.boolean(),
    openaiConfigured: z.boolean(),
    ssoEnabled: z.boolean(),
    a2aEnabled: z.boolean(),
  }),
})

export type HealthResponse = z.infer<typeof HealthResponseSchema>
