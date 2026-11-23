import { z } from 'zod'

export const SSO_AUDIENCE = 'sso:miraistudy' as const
export const SSO_FRESHNESS_MAX_SECONDS = 3600

export const SsoConsumeRequestSchema = z.strictObject({
  token: z.string().min(20).max(4096),
})

export type SsoConsumeRequest = z.infer<typeof SsoConsumeRequestSchema>

export const SsoConsumeResponseSchema = z.strictObject({
  customToken: z.string().min(1),
  uid: z.string().min(1),
  ssoAt: z.number().int().positive(),
})

export type SsoConsumeResponse = z.infer<typeof SsoConsumeResponseSchema>
