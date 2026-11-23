import type { HealthResponse } from '../shared/schemas/health'

export function useHealthCheck() {
  const health = useState<HealthResponse | null>('health:status', () => null)
  const pending = ref(false)
  const error = ref<string | null>(null)

  async function fetchHealth(): Promise<void> {
    pending.value = true
    error.value = null
    try {
      health.value = await $fetch<HealthResponse>('/api/health')
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'ヘルスチェックに失敗しました。'
    } finally {
      pending.value = false
    }
  }

  return {
    health,
    pending,
    error,
    fetchHealth,
  }
}
