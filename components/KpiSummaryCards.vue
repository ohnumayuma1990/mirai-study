<script setup lang="ts">
import type { SimulationReadyResponse } from '../shared/schemas/simulation'

interface Props {
  simulation: SimulationReadyResponse
}

const props = defineProps<Props>()

const passStatusText = computed(() => {
  const tgt = props.simulation.scenarios.target_pace
  if (tgt.willPass) {
    return `合格圏予測 (${tgt.projectedScoreAtTargetDate}%)`
  }
  return `要ペースアップ (${tgt.projectedScoreAtTargetDate}%)`
})

const passBadgeClass = computed(() =>
  props.simulation.scenarios.target_pace.willPass
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-amber-50 text-amber-700 border-amber-200',
)

const hoursProgressPct = computed(() =>
  Math.min(100, Math.round((props.simulation.cumulativeStudyHours / Math.max(1, props.simulation.targetTotalHours)) * 100)),
)
</script>

<template>
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
    <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p class="text-xs font-medium text-slate-500">累積学習時間</p>
      <p class="mt-1 text-2xl font-bold text-slate-900">
        {{ simulation.cumulativeStudyHours }}<span class="ml-1 text-xs font-normal text-slate-500">h</span>
      </p>
      <p class="mt-1 text-xs text-slate-500">
        目標 {{ simulation.targetTotalHours }}h ({{ hoursProgressPct }}%)
      </p>
    </div>

    <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p class="text-xs font-medium text-slate-500">現在推定スコア</p>
      <p class="mt-1 text-2xl font-bold text-indigo-600">
        {{ simulation.currentEstimatedScorePct }}<span class="ml-0.5 text-xs font-normal text-slate-500">%</span>
      </p>
      <p class="mt-1 text-xs text-slate-500">
        合格基準 {{ simulation.passingScorePct }}% / 目標 {{ simulation.targetScorePct }}%
      </p>
    </div>

    <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p class="text-xs font-medium text-slate-500">目標日まで</p>
      <p class="mt-1 text-2xl font-bold text-slate-900">
        {{ Math.max(0, simulation.daysRemaining) }}<span class="ml-1 text-xs font-normal text-slate-500">日</span>
      </p>
      <span
        class="mt-1 inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium"
        :class="passBadgeClass"
      >
        {{ passStatusText }}
      </span>
    </div>

    <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p class="text-xs font-medium text-slate-500">本日の復習キュー</p>
      <p
        class="mt-1 text-2xl font-bold"
        :class="simulation.dueReviewCount > 0 ? 'text-rose-600' : 'text-emerald-600'"
      >
        {{ simulation.dueReviewCount }}<span class="ml-1 text-xs font-normal text-slate-500">件</span>
      </p>
      <p class="mt-1 text-xs text-slate-500">
        直近平均 {{ simulation.observedDailyMinutesAvg }}分/日
      </p>
    </div>
  </div>
</template>
