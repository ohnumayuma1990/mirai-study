import { defineEventHandler } from 'h3'
import type { HealthResponse } from '../../shared/schemas/health'
import { isFirebaseAdminConfigured, isGcsConfigured } from '../utils/firebase-admin'
import { parseBooleanRuntimeFlag } from '../utils/runtime-config'

export default defineEventHandler((): HealthResponse => {
  const config = useRuntimeConfig()
  const firebaseAdminConfigured = isFirebaseAdminConfigured()
  const gcsConfigured = isGcsConfigured()
  const openaiConfigured = Boolean(String(config.openaiApiKey ?? '').trim())
  const ssoEnabled = parseBooleanRuntimeFlag(config.ssoEnabled, false)
  const a2aEnabled = parseBooleanRuntimeFlag(config.a2aEnabled, false)

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
