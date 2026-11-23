export default defineNuxtRouteMiddleware(async () => {
  // Never redirect on SSR; Firebase Auth resolves session on client
  if (import.meta.server) {
    return
  }

  const { user, authLoading, initAuthListener } = useFirebaseAuth()
  initAuthListener()

  if (authLoading.value) {
    await new Promise<void>((resolve) => {
      const stop = watch(
        authLoading,
        (loading) => {
          if (!loading) {
            stop()
            resolve()
          }
        },
        { immediate: true },
      )
    })
  }

  if (!user.value) {
    return navigateTo('/login')
  }
})
