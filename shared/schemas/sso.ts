import { z } from 'zod'

export const SSO_AUDIENCE = 'sso:miraistudy' as const
export const SSO_STATE_COOKIE_NAME = 'miraistudy_sso_state' as const
export const SSO_STATE_TTL_SECONDS = 300
export const SSO_STATE_REGEX = /^[0-9a-f]{64}$/
export const SSO_FRESHNESS_MAX_SECONDS = 3600

export const SsoStateSchema = z.string().regex(SSO_STATE_REGEX)

export const SsoConsumeRequestSchema = z.strictObject({
  code: z.string().min(20).max(4096),
  state: SsoStateSchema,
})

export type SsoConsumeRequest = z.infer<typeof SsoConsumeRequestSchema>

export const SsoConsumeResponseSchema = z.strictObject({
  customToken: z.string().min(1),
  uid: z.string().min(1),
  ssoAt: z.number().int().positive(),
})

export type SsoConsumeResponse = z.infer<typeof SsoConsumeResponseSchema>
