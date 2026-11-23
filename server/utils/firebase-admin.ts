import { cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getAuth, type Auth } from 'firebase-admin/auth'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { getStorage, type Storage } from 'firebase-admin/storage'
import { createError } from 'h3'

let cachedApp: App | null = null

export interface FirebaseAdminConfig {
  gcpProjectId?: string
  gcsBucketName?: string
  gcpClientEmail?: string
  gcpPrivateKey?: string
}

function readConfigFromRuntime(): FirebaseAdminConfig {
  const config = useRuntimeConfig()
  return {
    gcpProjectId: String(config.gcpProjectId ?? '').trim(),
    gcsBucketName: String(config.gcsBucketName ?? '').trim(),
    gcpClientEmail: String(config.gcpClientEmail ?? '').trim(),
    gcpPrivateKey: String(config.gcpPrivateKey ?? '').trim(),
  }
}

export function isFirebaseAdminConfigured(cfg?: FirebaseAdminConfig): boolean {
  const resolved = cfg ?? readConfigFromRuntime()
  return Boolean(resolved.gcpProjectId)
}

export function isGcsConfigured(cfg?: FirebaseAdminConfig): boolean {
  const resolved = cfg ?? readConfigFromRuntime()
  return Boolean(resolved.gcpProjectId && resolved.gcsBucketName)
}

export function getFirebaseAdminApp(cfg?: FirebaseAdminConfig): App {
  if (cachedApp) {
    return cachedApp
  }

  const existing = getApps()
  if (existing.length > 0) {
    cachedApp = existing[0]!
    return cachedApp
  }

  const resolved = cfg ?? readConfigFromRuntime()
  if (!resolved.gcpProjectId) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable: Firebase Admin (NUXT_GCP_PROJECT_ID) is not configured.',
    })
  }

  const storageBucket = resolved.gcsBucketName || undefined

  if (resolved.gcpClientEmail && resolved.gcpPrivateKey) {
    const privateKey = resolved.gcpPrivateKey.replace(/\\n/g, '\n')
    cachedApp = initializeApp({
      credential: cert({
        projectId: resolved.gcpProjectId,
        clientEmail: resolved.gcpClientEmail,
        privateKey,
      }),
      projectId: resolved.gcpProjectId,
      storageBucket,
    })
  } else {
    // Cloud Run production: Application Default Credentials (static keyless)
    cachedApp = initializeApp({
      projectId: resolved.gcpProjectId,
      storageBucket,
    })
  }

  return cachedApp
}

export function getAdminAuth(): Auth {
  return getAuth(getFirebaseAdminApp())
}

export function getAdminFirestore(): Firestore {
  return getFirestore(getFirebaseAdminApp())
}

export function getAdminStorageBucket() {
  const cfg = readConfigFromRuntime()
  if (!cfg.gcsBucketName) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable: Cloud Storage bucket (NUXT_GCS_BUCKET_NAME) is not configured.',
    })
  }
  const storage: Storage = getStorage(getFirebaseAdminApp(cfg))
  return storage.bucket(cfg.gcsBucketName)
}
