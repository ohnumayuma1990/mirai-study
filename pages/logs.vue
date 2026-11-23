<script setup lang="ts">
import type { StudyTrackInput } from '../shared/schemas/track'
import type { StudySession, StudySessionInput, StudySessionsListResponse } from '../shared/schemas/study-session'
import type { ExamLog, ExamLogInput, ExamLogsListResponse } from '../shared/schemas/exam-log'
import type { DevLog, DevLogInput, DevLogsListResponse } from '../shared/schemas/dev-log'
import type { ReviewGrade, ReviewItem, ReviewsListResponse } from '../shared/schemas/review-item'

definePageMeta({
  middleware: ['auth'],
})

const { user, authLoading } = useFirebaseAuth()
const { tracks, selectedTrackId, loadTracks, selectTrack } = useDashboard()
const { apiFetch } = useApiFetch()

const sessions = ref<StudySession[]>([])
const examLogs = ref<ExamLog[]>([])
const devLogs = ref<DevLog[]>([])
const allReviews = ref<ReviewItem[]>([])
const saving = ref(false)
const feedback = ref<string | null>(null)
const error = ref<string | null>(null)

// New review card quick form
const reviewTopic = ref('')
const reviewQuestion = ref('')
const reviewAnswer = ref('')

async function loadAllLogs(): Promise<void> {
  error.value = null
  try {
    await loadTracks()
    const trackId = selectedTrackId.value ?? undefined
    const [sRes, eRes, dRes, rRes] = await Promise.all([
      apiFetch<StudySessionsListResponse>('/api/study-sessions', { query: { trackId, limit: 20 } }),
      apiFetch<ExamLogsListResponse>('/api/exam-logs', { query: { trackId, limit: 20 } }),
      apiFetch<DevLogsListResponse>('/api/dev-logs', { query: { trackId, limit: 20 } }),
      apiFetch<ReviewsListResponse>('/api/reviews', { query: { trackId, status: 'active', limit: 50 } }),
    ])
    sessions.value = sRes.sessions
    examLogs.value = eRes.logs
    devLogs.value = dRes.logs
    allReviews.value = rRes.items
  } catch (err) {
    error.value = err instanceof Error ? err.message : '記録一覧の読み込みに失敗しました。'
  }
}

watch(
  () => [authLoading.value, user.value?.uid],
  ([loading, uid]) => {
    if (!loading && uid) {
      loadAllLogs()
    }
  },
  { immediate: true },
)

async function handleSaveTrack(payload: StudyTrackInput): Promise<void> {
  saving.value = true
  feedback.value = null
  error.value = null
  try {
    await apiFetch('/api/tracks', { method: 'PUT', body: payload })
    feedback.value = `学習トラック「${payload.title}」を保存しました。`
    await loadAllLogs()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'トラック保存に失敗しました。'
  } finally {
    saving.value = false
  }
}

async function handleSubmitSession(payload: StudySessionInput): Promise<void> {
  saving.value = true
  feedback.value = null
  error.value = null
  try {
    await apiFetch('/api/study-sessions', { method: 'POST', body: payload })
    feedback.value = '学習セッションを記録しました。'
    await loadAllLogs()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '学習セッションの保存に失敗しました。'
  } finally {
    saving.value = false
  }
}

async function handleSubmitExam(payload: ExamLogInput): Promise<void> {
  saving.value = true
  feedback.value = null
  error.value = null
  try {
    await apiFetch('/api/exam-logs', { method: 'POST', body: payload })
    feedback.value = '演習・模試スコアを記録しました。'
    await loadAllLogs()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '演習ログの保存に失敗しました。'
  } finally {
    saving.value = false
  }
}

async function handleSubmitDev(payload: DevLogInput): Promise<void> {
  saving.value = true
  feedback.value = null
  error.value = null
  try {
    await apiFetch('/api/dev-logs', { method: 'POST', body: payload })
    feedback.value = '開発・ハンズオン進捗を記録しました。'
    await loadAllLogs()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '開発ログの保存に失敗しました。'
  } finally {
    saving.value = false
  }
}

async function handleAddReviewCard(): Promise<void> {
  if (!selectedTrackId.value) return
  saving.value = true
  feedback.value = null
  error.value = null
  try {
    await apiFetch('/api/reviews', {
      method: 'POST',
      body: {
        trackId: selectedTrackId.value,
        topic: reviewTopic.value.trim(),
        questionOrPrompt: reviewQuestion.value.trim(),
        answerOrNote: reviewAnswer.value.trim(),
      },
    })
    reviewTopic.value = ''
    reviewQuestion.value = ''
    reviewAnswer.value = ''
    feedback.value = '復習カードを登録しました。'
    await loadAllLogs()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '復習カードの登録に失敗しました。'
  } finally {
    saving.value = false
  }
}

async function handleGradeReview(payload: { id: string; grade: ReviewGrade }): Promise<void> {
  saving.value = true
  try {
    await apiFetch('/api/reviews/grade', { method: 'POST', body: payload })
    await loadAllLogs()
  } finally {
    saving.value = false
  }
}

async function onTrackChange(id: string): Promise<void> {
  await selectTrack(id)
  await loadAllLogs()
}
</script>

<template>
  <div class="space-y-6">
    <div v-if="feedback" class="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
      {{ feedback }}
    </div>
    <div v-if="error" class="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
      {{ error }}
    </div>

    <!-- Track Selector -->
    <div v-if="tracks.length > 0" class="flex flex-wrap items-center gap-2">
      <button
        v-for="t in tracks"
        :key="t.id"
        type="button"
        class="rounded-full border px-3 py-1 text-xs font-semibold"
        :class="t.id === selectedTrackId ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-700'"
        @click="onTrackChange(t.id)"
      >
        {{ t.title }}
      </button>
    </div>

    <!-- Study / Exam / Dev Forms -->
    <StudyLogForms
      :tracks="tracks"
      :selected-track-id="selectedTrackId ?? ''"
      :saving="saving"
      @submit-session="handleSubmitSession"
      @submit-exam="handleSubmitExam"
      @submit-dev="handleSubmitDev"
    />

    <!-- Quick Review Card Creation -->
    <form
      v-if="selectedTrackId"
      class="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      @submit.prevent="handleAddReviewCard"
    >
      <h3 class="text-base font-bold text-slate-900">復習カードを追加</h3>
      <input
        v-model="reviewTopic"
        type="text"
        required
        placeholder="論点・単元名 (例: IAM ポリシー評価論理)"
        class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
      >
      <input
        v-model="reviewQuestion"
        type="text"
        required
        placeholder="確認ポイント・問いかけ"
        class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
      >
      <textarea
        v-model="reviewAnswer"
        rows="2"
        required
        placeholder="要点メモ・解答"
        class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        :disabled="saving"
        class="w-full rounded-xl bg-slate-900 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        復習キューに追加
      </button>
    </form>

    <!-- Review Queue -->
    <ReviewQueueCard
      :items="allReviews"
      :loading="saving"
      @grade="handleGradeReview"
    />

    <!-- Track Creation / Edit -->
    <TrackGoalsForm :saving="saving" @submit="handleSaveTrack" />

    <!-- Recent Logs Overview -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 class="text-sm font-bold text-slate-900">最近の学習セッション ({{ sessions.length }})</h3>
        <ul class="mt-2 space-y-2 text-xs">
          <li v-for="s in sessions.slice(0, 8)" :key="s.id" class="flex justify-between border-b border-slate-100 pb-1.5">
            <span class="truncate pr-2 font-medium text-slate-800">{{ s.studiedDate }} · {{ s.materialOrTopic }}</span>
            <span class="shrink-0 font-semibold text-indigo-600">{{ s.durationMinutes }}分</span>
          </li>
          <li v-if="sessions.length === 0" class="text-slate-400">記録がありません。</li>
        </ul>
      </div>

      <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 class="text-sm font-bold text-slate-900">最近の演習・模試 ({{ examLogs.length }}) / 開発 ({{ devLogs.length }})</h3>
        <ul class="mt-2 space-y-2 text-xs">
          <li v-for="e in examLogs.slice(0, 5)" :key="e.id" class="flex justify-between border-b border-slate-100 pb-1.5">
            <span class="truncate pr-2 font-medium text-slate-800">{{ e.takenDate }} · {{ e.examName }}</span>
            <span class="shrink-0 font-semibold text-emerald-600">{{ e.scorePct }}%</span>
          </li>
          <li v-for="d in devLogs.slice(0, 5)" :key="d.id" class="flex justify-between border-b border-slate-100 pb-1.5">
            <span class="truncate pr-2 font-medium text-slate-800">{{ d.loggedDate }} · [Dev] {{ d.featureSummary }}</span>
            <span class="shrink-0 text-slate-500">{{ d.handsOnMinutes }}分</span>
          </li>
          <li v-if="examLogs.length === 0 && devLogs.length === 0" class="text-slate-400">記録がありません。</li>
        </ul>
      </div>
    </div>
  </div>
</template>
