<script setup lang="ts">
import type { ReviewGrade } from '../shared/schemas/review-item'

definePageMeta({
  middleware: ['auth'],
})

const { user, authLoading } = useFirebaseAuth()
const {
  tracks,
  selectedTrackId,
  dailyMinutesOverride,
  simulation,
  dueReviews,
  pending,
  error,
  loadDashboardData,
  selectTrack,
  updateDailyMinutesOverride,
  submitReviewGrade,
} = useDashboard()

const sliderMinutes = ref(90)
const grading = ref(false)

watch(
  () => [authLoading.value, user.value?.uid],
  ([loading, uid]) => {
    if (!loading && uid) {
      loadDashboardData()
    }
  },
  { immediate: true },
)

watch(
  dailyMinutesOverride,
  (val) => {
    if (typeof val === 'number') {
      sliderMinutes.value = val
    }
  },
  { immediate: true },
)

async function handleSliderChange(): Promise<void> {
  await updateDailyMinutesOverride(sliderMinutes.value)
}

async function handleGradeReview(payload: { id: string; grade: ReviewGrade }): Promise<void> {
  grading.value = true
  try {
    await submitReviewGrade(payload.id, payload.grade)
  } finally {
    grading.value = false
  }
}
</script>

<template>
  <div class="space-y-5">
    <div v-if="authLoading" class="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
      認証状態を確認しています...
    </div>

    <template v-else>
      <!-- Track Switcher Pills -->
      <div v-if="tracks.length > 0" class="flex flex-wrap items-center gap-2">
        <button
          v-for="track in tracks"
          :key="track.id"
          type="button"
          class="rounded-full border px-3.5 py-1.5 text-xs font-semibold transition"
          :class="
            track.id === selectedTrackId
              ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
          "
          @click="selectTrack(track.id)"
        >
          {{ track.title }}
        </button>
        <NuxtLink
          to="/logs"
          class="rounded-full border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-500 hover:border-indigo-400 hover:text-indigo-600"
        >
          + トラック管理
        </NuxtLink>
      </div>

      <!-- Error State (Fail-Closed) -->
      <div
        v-if="error"
        class="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
      >
        <p class="font-semibold">データの読み込みに失敗しました</p>
        <p class="mt-1 text-xs">{{ error }}</p>
        <button
          type="button"
          class="mt-3 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white"
          @click="loadDashboardData"
        >
          再試行
        </button>
      </div>

      <!-- Pending State -->
      <div
        v-else-if="pending && !simulation"
        class="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500"
      >
        未来予測データを計算しています...
      </div>

      <!-- Needs Setup State -->
      <div
        v-else-if="simulation && simulation.status === 'needs_setup'"
        class="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-6 text-center"
      >
        <h2 class="text-base font-bold text-indigo-900">初期セットアップが必要です</h2>
        <p class="mt-2 text-sm text-indigo-800">{{ simulation.message }}</p>
        <div class="mt-4 flex flex-wrap justify-center gap-3">
          <NuxtLink
            to="/logs"
            class="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            学習トラック・記録を登録する
          </NuxtLink>
          <NuxtLink
            to="/ingest"
            class="rounded-xl border border-indigo-300 bg-white px-4 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
          >
            画像から取り込む (Vision AI)
          </NuxtLink>
        </div>
      </div>

      <!-- Ready State -->
      <template v-else-if="simulation && simulation.status === 'ready'">
        <!-- Retention Alert Banner -->
        <div
          v-if="simulation.retentionAlert.severity !== 'none'"
          class="rounded-2xl border p-3.5 text-xs"
          :class="
            simulation.retentionAlert.severity === 'critical'
              ? 'border-rose-200 bg-rose-50 text-rose-800'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          "
        >
          <p class="font-semibold">忘却アラート</p>
          <p class="mt-0.5">{{ simulation.retentionAlert.message }}</p>
        </div>

        <KpiSummaryCards :simulation="simulation" />

        <!-- What-If Daily Goal Slider -->
        <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="flex items-center justify-between">
            <label for="daily-minutes-slider" class="text-xs font-semibold text-slate-700">
              What-If シミュレーション（1日あたりの目標学習時間）
            </label>
            <span class="rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">
              {{ sliderMinutes }} 分 / 日
            </span>
          </div>
          <input
            id="daily-minutes-slider"
            v-model.number="sliderMinutes"
            type="range"
            min="30"
            max="360"
            step="15"
            class="mt-3 w-full accent-indigo-600"
            @change="handleSliderChange"
          >
          <div class="mt-1 flex justify-between text-[11px] text-slate-400">
            <span>30分</span>
            <span>120分</span>
            <span>240分</span>
            <span>360分</span>
          </div>
        </div>

        <FutureSimulatorChart :simulation="simulation" />

        <ReviewQueueCard
          :items="dueReviews"
          :loading="grading"
          @grade="handleGradeReview"
        />
      </template>
    </template>
  </div>
</template>
