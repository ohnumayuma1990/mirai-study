import { getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  getAuth,
  onAuthStateChanged,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth'

let firebaseAppInstance: FirebaseApp | null = null
let authListenerBound = false

export function useFirebaseAuth() {
  const config = useRuntimeConfig()
  const user = useState<User | null>('auth:user', () => null)
  const authLoading = useState<boolean>('auth:loading', () => true)
  const authError = useState<string | null>('auth:error', () => null)

  const isFirebaseConfigured = computed(() =>
    Boolean(
      config.public.firebaseApiKey &&
      config.public.firebaseAuthDomain &&
      config.public.firebaseProjectId,
    ),
  )

  function getClientAuth(): Auth | null {
    if (!import.meta.client) return null
    if (!isFirebaseConfigured.value) {
      authError.value = 'Firebase 公開設定 (NUXT_PUBLIC_FIREBASE_*) が未設定です。'
      authLoading.value = false
      return null
    }

    if (!firebaseAppInstance) {
      const existing = getApps()
      firebaseAppInstance =
        existing.length > 0
          ? existing[0]!
          : initializeApp({
              apiKey: String(config.public.firebaseApiKey),
              authDomain: String(config.public.firebaseAuthDomain),
              projectId: String(config.public.firebaseProjectId),
            })
    }
    return getAuth(firebaseAppInstance)
  }

  function initAuthListener(): void {
    if (!import.meta.client || authListenerBound) return
    const auth = getClientAuth()
    if (!auth) return

    authListenerBound = true
    onAuthStateChanged(
      auth,
      (firebaseUser) => {
        user.value = firebaseUser
        authLoading.value = false
      },
      (err) => {
        authError.value = err.message
        authLoading.value = false
      },
    )
  }

  async function loginWithEmail(email: string, password: string): Promise<void> {
    authError.value = null
    const auth = getClientAuth()
    if (!auth) {
      throw new Error('Firebase 認証が設定されていません。')
    }
    const credential = await signInWithEmailAndPassword(auth, email, password)
    user.value = credential.user
  }

  async function loginWithCustomToken(customToken: string): Promise<void> {
    authError.value = null
    const auth = getClientAuth()
    if (!auth) {
      throw new Error('Firebase 認証が設定されていません。')
    }
    const credential = await signInWithCustomToken(auth, customToken)
    user.value = credential.user
  }

  async function logout(): Promise<void> {
    const auth = getClientAuth()
    if (auth) {
      await signOut(auth)
    }
    user.value = null
  }

  async function getIdToken(forceRefresh = false): Promise<string> {
    const auth = getClientAuth()
    const current = auth?.currentUser ?? user.value
    if (!current) {
      throw new Error('認証セッションが存在しません。再ログインしてください。')
    }
    return current.getIdToken(forceRefresh)
  }

  return {
    user,
    authLoading,
    authError,
    isFirebaseConfigured,
    initAuthListener,
    loginWithEmail,
    loginWithCustomToken,
    logout,
    getIdToken,
  }
}
