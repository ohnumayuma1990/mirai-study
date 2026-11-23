import type { StudyTrack, TracksListResponse } from '../shared/schemas/track'
import type { SimulationResponse } from '../shared/schemas/simulation'
import type { ReviewGrade, ReviewItem, ReviewsListResponse } from '../shared/schemas/review-item'

export function useDashboard() {
  const { apiFetch } = useApiFetch()

  const tracks = useState<StudyTrack[]>('dashboard:tracks', () => [])
  const selectedTrackId = useState<string | null>('dashboard:selectedTrackId', () => null)
  const dailyMinutesOverride = useState<number | null>('dashboard:dailyMinutesOverride', () => null)
  const simulation = useState<SimulationResponse | null>('dashboard:simulation', () => null)
  const dueReviews = useState<ReviewItem[]>('dashboard:dueReviews', () => [])
  const pending = useState<boolean>('dashboard:pending', () => false)
  const error = useState<string | null>('dashboard:error', () => null)

  let inFlight = false

  const activeTrack = computed<StudyTrack | null>(() => {
    if (tracks.value.length === 0) return null
    return (
      tracks.value.find((t) => t.id === selectedTrackId.value) ??
      tracks.value.find((t) => t.isDefault) ??
      tracks.value[0] ??
      null
    )
  })

  async function loadTracks(): Promise<void> {
    const res = await apiFetch<TracksListResponse>('/api/tracks')
    tracks.value = res.tracks
    if (!selectedTrackId.value || !res.tracks.some((t) => t.id === selectedTrackId.value)) {
      const def = res.tracks.find((t) => t.isDefault) ?? res.tracks[0]
      selectedTrackId.value = def?.id ?? null
      if (def && dailyMinutesOverride.value === null) {
        dailyMinutesOverride.value = def.dailyGoalMinutes
      }
    }
  }

  async function loadDashboardData(): Promise<void> {
    if (inFlight) return
    inFlight = true
    pending.value = true
    error.value = null

    try {
      await loadTracks()
      const trackId = selectedTrackId.value ?? undefined
      const simQuery: Record<string, string | number | undefined> = {
        trackId,
        dailyMinutesOverride: dailyMinutesOverride.value ?? undefined,
      }

      const [simRes, revRes] = await Promise.all([
        apiFetch<SimulationResponse>('/api/simulation', { query: simQuery }),
        trackId
          ? apiFetch<ReviewsListResponse>('/api/reviews', {
              query: { trackId, status: 'active', dueOnly: true, limit: 30 },
            })
          : Promise.resolve<ReviewsListResponse>({ items: [], dueCount: 0 }),
      ])

      simulation.value = simRes
      dueReviews.value = revRes.items
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'ダッシュボードデータの取得に失敗しました。'
    } finally {
      pending.value = false
      inFlight = false
    }
  }

  async function selectTrack(trackId: string): Promise<void> {
    selectedTrackId.value = trackId
    const found = tracks.value.find((t) => t.id === trackId)
    if (found) {
      dailyMinutesOverride.value = found.dailyGoalMinutes
    }
    await loadDashboardData()
  }

  async function updateDailyMinutesOverride(minutes: number): Promise<void> {
    dailyMinutesOverride.value = minutes
    if (!selectedTrackId.value) return
    pending.value = true
    error.value = null
    try {
      simulation.value = await apiFetch<SimulationResponse>('/api/simulation', {
        query: {
          trackId: selectedTrackId.value,
          dailyMinutesOverride: minutes,
        },
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'シミュレーション更新に失敗しました。'
    } finally {
      pending.value = false
    }
  }

  async function submitReviewGrade(itemId: string, grade: ReviewGrade): Promise<void> {
    await apiFetch('/api/reviews/grade', {
      method: 'POST',
      body: { id: itemId, grade },
    })
    await loadDashboardData()
  }

  return {
    tracks,
    selectedTrackId,
    activeTrack,
    dailyMinutesOverride,
    simulation,
    dueReviews,
    pending,
    error,
    loadTracks,
    loadDashboardData,
    selectTrack,
    updateDailyMinutesOverride,
    submitReviewGrade,
  }
}
