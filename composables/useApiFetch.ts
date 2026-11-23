export interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  query?: Record<string, string | number | boolean | undefined>
  body?: BodyInit | Record<string, unknown> | null
}

export function useApiFetch() {
  const { getIdToken } = useFirebaseAuth()

  async function apiFetch<T>(url: string, options: ApiFetchOptions = {}): Promise<T> {
    const token = await getIdToken()
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    }

    const response = await $fetch<unknown>(url, {
      method: options.method ?? 'GET',
      query: options.query,
      body: options.body,
      headers,
    })
    return response as T
  }

  return { apiFetch }
}
