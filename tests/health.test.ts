import { describe, expect, it } from 'vitest'
import { HealthResponseSchema } from '../shared/schemas/health'
import { isFirebaseAdminConfigured, isGcsConfigured } from '../server/utils/firebase-admin'

describe('health & fail-closed config checks', () => {
  it('validates HealthResponse schema contract', () => {
    const parsed = HealthResponseSchema.safeParse({
      status: 'degraded',
      service: 'mirai-study',
      timestamp: '2026-11-22T00:00:00.000Z',
      checks: {
        firebaseAdminConfigured: false,
        gcsConfigured: false,
        openaiConfigured: false,
        ssoEnabled: false,
        a2aEnabled: false,
      },
    })
    expect(parsed.success).toBe(true)
  })

  it('reports false when GCP project or GCS bucket is missing', () => {
    expect(isFirebaseAdminConfigured({ gcpProjectId: '' })).toBe(false)
    expect(isFirebaseAdminConfigured({ gcpProjectId: 'my-proj' })).toBe(true)
    expect(isGcsConfigured({ gcpProjectId: 'my-proj', gcsBucketName: '' })).toBe(false)
    expect(isGcsConfigured({ gcpProjectId: 'my-proj', gcsBucketName: 'my-bucket' })).toBe(true)
  })
})
