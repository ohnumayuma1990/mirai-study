<script setup lang="ts">
import type { StudyTrack, StudyTrackInput, TrackCategory } from '../shared/schemas/track'

interface Props {
  existingTrack?: StudyTrack | null
  saving?: boolean
}

interface Emits {
  (e: 'submit', payload: StudyTrackInput): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const defaultTargetDate = computed(() => {
  const d = new Date()
  d.setDate(d.getDate() + 90)
  return d.toISOString().slice(0, 10)
})

const title = ref(props.existingTrack?.title ?? '')
const category = ref<TrackCategory>(props.existingTrack?.category ?? 'certification')
const targetDate = ref(props.existingTrack?.targetDate ?? defaultTargetDate.value)
const targetScorePct = ref(props.existingTrack?.targetScorePct ?? 80)
const passingScorePct = ref(props.existingTrack?.passingScorePct ?? 70)
const targetTotalHours = ref(props.existingTrack?.targetTotalHours ?? 120)
const dailyGoalMinutes = ref(props.existingTrack?.dailyGoalMinutes ?? 90)
const isDefault = ref(props.existingTrack?.isDefault ?? true)

watch(
  () => props.existingTrack,
  (track) => {
    if (!track) return
    title.value = track.title
    category.value = track.category
    targetDate.value = track.targetDate
    targetScorePct.value = track.targetScorePct
    passingScorePct.value = track.passingScorePct
    targetTotalHours.value = track.targetTotalHours
    dailyGoalMinutes.value = track.dailyGoalMinutes
    isDefault.value = track.isDefault
  },
)

function handleSubmit(): void {
  emit('submit', {
    ...(props.existingTrack?.id ? { id: props.existingTrack.id } : {}),
    title: title.value.trim(),
    category: category.value,
    targetDate: targetDate.value,
    targetScorePct: Number(targetScorePct.value),
    passingScorePct: Number(passingScorePct.value),
    targetTotalHours: Number(targetTotalHours.value),
    dailyGoalMinutes: Number(dailyGoalMinutes.value),
    isDefault: isDefault.value,
  })
}
</script>

<template>
  <form class="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" @submit.prevent="handleSubmit">
    <h3 class="text-base font-bold text-slate-900">
      {{ existingTrack ? '学習トラック目標を編集' : '新しい学習トラックを作成' }}
    </h3>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label class="block text-xs font-medium text-slate-700">
        学習テーマ名
        <input
          v-model="title"
          type="text"
          required
          placeholder="例: AWS SAA / TypeScript実践"
          class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
        >
      </label>

      <label class="block text-xs font-medium text-slate-700">
        カテゴリ
        <select
          v-model="category"
          class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="certification">資格試験</option>
          <option value="programming">プログラミング・技術習得</option>
          <option value="language">語学</option>
          <option value="general">その他学習</option>
        </select>
      </label>

      <label class="block text-xs font-medium text-slate-700">
        試験日 / 目標期限日
        <input
          v-model="targetDate"
          type="date"
          required
          class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
        >
      </label>

      <label class="block text-xs font-medium text-slate-700">
        1日目標学習時間 (分)
        <input
          v-model.number="dailyGoalMinutes"
          type="number"
          min="10"
          max="720"
          required
          class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
        >
      </label>

      <label class="block text-xs font-medium text-slate-700">
        目標スコア (%)
        <input
          v-model.number="targetScorePct"
          type="number"
          min="0"
          max="100"
          required
          class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
        >
      </label>

      <label class="block text-xs font-medium text-slate-700">
        合格基準ライン (%)
        <input
          v-model.number="passingScorePct"
          type="number"
          min="0"
          max="100"
          required
          class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
        >
      </label>

      <label class="block text-xs font-medium text-slate-700">
        目標総学習時間 (時間)
        <input
          v-model.number="targetTotalHours"
          type="number"
          min="1"
          max="10000"
          required
          class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
        >
      </label>

      <label class="flex items-center gap-2 pt-5 text-xs font-medium text-slate-700">
        <input v-model="isDefault" type="checkbox" class="h-4 w-4 rounded border-slate-300 text-indigo-600">
        ダッシュボードのデフォルトトラックにする
      </label>
    </div>

    <button
      type="submit"
      :disabled="saving"
      class="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
    >
      {{ saving ? '保存中...' : 'トラックを保存' }}
    </button>
  </form>
</template>
