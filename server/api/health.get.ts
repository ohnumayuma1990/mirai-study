import { defineEventHandler } from 'h3'
import type { HealthResponse } from '../../shared/schemas/health'
import { isFirebaseAdminConfigured, isGcsConfigured } from '../utils/firebase-admin'

export default defineEventHandler((): HealthResponse => {
  const config = useRuntimeConfig()
  const firebaseAdminConfigured = isFirebaseAdminConfigured()
  const gcsConfigured = isGcsConfigured()
  const openaiConfigured = Boolean(String(config.openaiApiKey ?? '').trim())
  const ssoEnabled = Boolean(config.ssoEnabled)
  const a2aEnabled = Boolean(config.a2aEnabled)

  const allCoreReady = firebaseAdminConfigured && gcsConfigured && openaiConfigured

  return {
    status: allCoreReady ? 'ok' : 'degraded',
    service: 'mirai-study',
    timestamp: new Date().toISOString(),
    checks: {
      firebaseAdminConfigured,
      gcsConfigured,
      openaiConfigured,
      ssoEnabled,
      a2aEnabled,
    },
  }
})
