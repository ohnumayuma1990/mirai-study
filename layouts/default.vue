<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const { user, logout } = useFirebaseAuth()

const showNav = computed(() => !route.path.startsWith('/login') && !route.path.startsWith('/auth/'))

async function handleLogout(): Promise<void> {
  await logout()
  await router.push('/login')
}
</script>

<template>
  <div class="min-h-screen bg-slate-50 text-slate-900">
    <header class="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div class="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
        <NuxtLink to="/" class="flex items-center gap-2 font-bold text-indigo-700">
          <span class="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white">
            MS
          </span>
          <span>MiraiStudy</span>
        </NuxtLink>

        <div v-if="user" class="flex items-center gap-3">
          <span class="hidden text-xs text-slate-500 sm:inline">{{ user.email ?? 'ログイン中' }}</span>
          <button
            type="button"
            class="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
            @click="handleLogout"
          >
            ログアウト
          </button>
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-4xl px-4 pb-24 pt-5">
      <slot />
    </main>

    <nav
      v-if="showNav"
      class="fixed bottom-0 left-0 right-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur"
    >
      <div class="mx-auto grid max-w-4xl grid-cols-3 text-center text-xs font-medium">
        <NuxtLink
          to="/"
          class="flex flex-col items-center py-2.5"
          :class="route.path === '/' ? 'text-indigo-600 font-bold' : 'text-slate-500'"
        >
          <span>未来予測</span>
        </NuxtLink>
        <NuxtLink
          to="/ingest"
          class="flex flex-col items-center py-2.5"
          :class="route.path === '/ingest' ? 'text-indigo-600 font-bold' : 'text-slate-500'"
        >
          <span>Vision解析</span>
        </NuxtLink>
        <NuxtLink
          to="/logs"
          class="flex flex-col items-center py-2.5"
          :class="route.path === '/logs' ? 'text-indigo-600 font-bold' : 'text-slate-500'"
        >
          <span>記録・復習</span>
        </NuxtLink>
      </div>
    </nav>
  </div>
</template>
