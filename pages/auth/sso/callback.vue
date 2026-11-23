<script setup lang="ts">
import { SSO_STATE_REGEX, type SsoConsumeResponse } from '~/shared/schemas/sso'

const router = useRouter()
const { loginWithCustomToken } = useFirebaseAuth()

const status = ref<'processing' | 'error'>('processing')
const errorMessage = ref<string | null>(null)

onMounted(async () => {
  const rawHash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : ''
  const hasLegacyQueryToken = new URLSearchParams(window.location.search).has('token')

  // Immediately strip sensitive fragment/query parameters from the URL bar and browser history
  window.history.replaceState(null, '', window.location.pathname)

  if (hasLegacyQueryToken && !rawHash) {
    status.value = 'error'
    errorMessage.value = '旧 SSO 形式（?token=）は終了しました。AI ROZA Hub から再度ログインしてください。'
    return
  }

  const hashParams = new URLSearchParams(rawHash)
  const code = hashParams.get('code')?.trim() ?? ''
  const state = hashParams.get('state')?.trim() ?? ''

  if (!code || !SSO_STATE_REGEX.test(state)) {
    status.value = 'error'
    errorMessage.value = 'SSO コールバックの code または state が不正です。'
    return
  }

  try {
    const res = await $fetch<SsoConsumeResponse>('/api/auth/sso/consume', {
      method: 'POST',
      body: { code, state },
    })
    await loginWithCustomToken(res.customToken)
    await router.replace('/')
  } catch (err) {
    status.value = 'error'
    errorMessage.value = err instanceof Error ? err.message : 'SSO 認証に失敗しました。'
  }
})
</script>

<template>
  <div class="mx-auto mt-16 max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
    <template v-if="status === 'processing'">
      <h1 class="text-lg font-bold text-slate-900">SSO 認証を処理しています...</h1>
      <p class="mt-2 text-xs text-slate-500">AI ROZA からのセッションを検証中です。</p>
    </template>
    <template v-else>
      <h1 class="text-lg font-bold text-rose-700">SSO 認証エラー</h1>
      <p class="mt-2 text-xs text-slate-600">{{ errorMessage }}</p>
      <NuxtLink
        to="/login"
        class="mt-4 inline-block rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white"
      >
        ログイン画面へ戻る
      </NuxtLink>
    </template>
  </div>
</template>
