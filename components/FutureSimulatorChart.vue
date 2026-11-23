<script setup lang="ts">
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js'
import { Line } from 'vue-chartjs'
import type { SimulationReadyResponse } from '../shared/schemas/simulation'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
)

interface Props {
  simulation: SimulationReadyResponse
}

const props = defineProps<Props>()

const sampledPoints = computed(() => {
  const pts = props.simulation.points
  if (pts.length <= 45) return pts
  const step = Math.ceil(pts.length / 45)
  return pts.filter((_, idx) => idx === 0 || idx === pts.length - 1 || idx % step === 0)
})

const chartData = computed<ChartData<'line'>>(() => {
  const pts = sampledPoints.value
  return {
    labels: pts.map((p) => p.date.slice(5)),
    datasets: [
      {
        label: `集中＋復習 (${props.simulation.scenarios.intensive_pace.dailyMinutes}分/日)`,
        data: pts.map((p) => p.intensiveScorePct),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.08)',
        fill: '+1',
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2,
      },
      {
        label: `目標ペース (${props.simulation.scenarios.target_pace.dailyMinutes}分/日)`,
        data: pts.map((p) => p.targetScorePct),
        borderColor: '#4f46e5',
        backgroundColor: 'rgba(79, 70, 229, 0.08)',
        fill: '+1',
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2.5,
      },
      {
        label: `現状トレンド (${props.simulation.scenarios.observed_trend.dailyMinutes}分/日)`,
        data: pts.map((p) => p.observedScorePct),
        borderColor: '#f59e0b',
        borderDash: [6, 4],
        fill: false,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2,
      },
      {
        label: `合格ライン (${props.simulation.passingScorePct}%)`,
        data: pts.map(() => props.simulation.passingScorePct),
        borderColor: '#ef4444',
        borderDash: [3, 3],
        fill: false,
        pointRadius: 0,
        borderWidth: 1.5,
      },
    ],
  }
})

const chartOptions = computed<ChartOptions<'line'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    mode: 'index',
    intersect: false,
  },
  plugins: {
    legend: {
      position: 'bottom',
      labels: {
        boxWidth: 12,
        font: { size: 11 },
      },
    },
    tooltip: {
      callbacks: {
        label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}%`,
      },
    },
  },
  scales: {
    y: {
      min: 0,
      max: 100,
      ticks: {
        callback: (val) => `${val}%`,
      },
    },
  },
}))
</script>

<template>
  <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-base font-bold text-slate-900">3シナリオ未来予測ファンチャート</h2>
        <p class="text-xs text-slate-500">
          目標日 {{ simulation.targetDate }} までの予測習熟度スコア(%)推移
        </p>
      </div>
    </div>

    <div class="h-64 w-full sm:h-72">
      <ClientOnly>
        <Line :data="chartData" :options="chartOptions" />
        <template #fallback>
          <div class="flex h-full items-center justify-center text-sm text-slate-400">
            グラフを読み込み中...
          </div>
        </template>
      </ClientOnly>
    </div>

    <div class="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
      <div
        v-for="item in [
          simulation.scenarios.observed_trend,
          simulation.scenarios.target_pace,
          simulation.scenarios.intensive_pace,
        ]"
        :key="item.scenario"
        class="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs"
      >
        <p class="font-semibold text-slate-700">{{ item.label }}</p>
        <p class="mt-1 text-lg font-bold text-slate-900">{{ item.projectedScoreAtTargetDate }}%</p>
        <p class="text-slate-500">
          到達予定: {{ item.estimatedPassDate ?? '期間内未達' }} / 計 {{ item.projectedHoursAtTargetDate }}h
        </p>
      </div>
    </div>
  </div>
</template>
