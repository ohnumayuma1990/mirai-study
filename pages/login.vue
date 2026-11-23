<script setup lang="ts">
const router = useRouter()
const config = useRuntimeConfig()
const { user, authLoading, authError, isFirebaseConfigured, loginWithEmail } = useFirebaseAuth()

const email = ref('')
const password = ref('')
const submitting = ref(false)
const localError = ref<string | null>(null)

watchEffect(() => {
  if (!authLoading.value && user.value) {
    router.replace('/')
  }
})

async function handleLogin(): Promise<void> {
  localError.value = null
  submitting.value = true
  try {
    await loginWithEmail(email.value.trim(), password.value)
    await router.push('/')
  } catch (err) {
    localError.value = err instanceof Error ? err.message : 'ログインに失敗しました。'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto mt-10 max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <h1 class="text-xl font-bold text-slate-900">MiraiStudy ログイン</h1>
    <p class="mt-1 text-xs text-slate-500">
      資格試験・技術習得の学習記録と3シナリオ未来予測を開始します。
    </p>

    <div
      v-if="!isFirebaseConfigured"
      class="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
    >
      Firebase Web 設定（NUXT_PUBLIC_FIREBASE_*）が未設定のためログインできません。環境設定を確認してください。
    </div>

    <div
      v-if="localError || authError"
      class="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700"
    >
      {{ localError || authError }}
    </div>

    <form class="mt-5 space-y-4" @submit.prevent="handleLogin">
      <label class="block text-xs font-medium text-slate-700">
        メールアドレス
        <input
          v-model="email"
          type="email"
          required
          autocomplete="email"
          class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
        >
      </label>

      <label class="block text-xs font-medium text-slate-700">
        パスワード
        <input
          v-model="password"
          type="password"
          required
          autocomplete="current-password"
          class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
        >
      </label>

      <button
        type="submit"
        :disabled="submitting || !isFirebaseConfigured"
        class="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {{ submitting ? '認証中...' : 'ログイン' }}
      </button>
    </form>

    <p v-if="config.public.ssoEnabled" class="mt-4 text-center text-xs text-slate-500">
      AI ROZA Hub からの SSO ログインが有効です。
    </p>
  </div>
</template>
