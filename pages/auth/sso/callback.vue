<script setup lang="ts">
import type { SsoConsumeResponse } from '../../../shared/schemas/sso'

const route = useRoute()
const router = useRouter()
const { loginWithCustomToken } = useFirebaseAuth()

const status = ref<'processing' | 'error'>('processing')
const errorMessage = ref<string | null>(null)

onMounted(async () => {
  const token = typeof route.query.token === 'string' ? route.query.token.trim() : ''
  if (!token) {
    status.value = 'error'
    errorMessage.value = 'SSO トークンが指定されていません。'
    return
  }

  try {
    const res = await $fetch<SsoConsumeResponse>('/api/auth/sso/consume', {
      method: 'POST',
      body: { token },
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
