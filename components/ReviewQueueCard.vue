<script setup lang="ts">
import type { ReviewGrade, ReviewItem } from '../shared/schemas/review-item'

interface Props {
  items: ReviewItem[]
  loading?: boolean
}

interface Emits {
  (e: 'grade', payload: { id: string; grade: ReviewGrade }): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const revealedIds = ref<Record<string, boolean>>({})

function toggleReveal(id: string): void {
  revealedIds.value = {
    ...revealedIds.value,
    [id]: !revealedIds.value[id],
  }
}

function handleGrade(id: string, grade: ReviewGrade): void {
  emit('grade', { id, grade })
}
</script>

<template>
  <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div class="mb-3 flex items-center justify-between">
      <div>
        <h2 class="text-base font-bold text-slate-900">忘却曲線・復習キュー</h2>
        <p class="text-xs text-slate-500">Stage 0→5（1日 / 3日 / 7日 / 14日 / 30日 / 60日）</p>
      </div>
      <span class="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
        {{ props.items.length }} 件
      </span>
    </div>

    <div v-if="props.items.length === 0" class="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500">
      現在期限の復習アイテムはありません。
    </div>

    <div v-else class="space-y-3">
      <div
        v-for="item in props.items"
        :key="item.id"
        class="rounded-xl border border-slate-200 p-3"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
            {{ item.topic }}
          </span>
          <span class="text-xs text-slate-500">
            Stage {{ item.stage }} / 次回 {{ item.nextReviewDate }}
          </span>
        </div>

        <p class="mt-2 text-sm font-medium text-slate-900">{{ item.questionOrPrompt }}</p>

        <div class="mt-2">
          <button
            type="button"
            class="text-xs font-medium text-indigo-600 hover:underline"
            @click="toggleReveal(item.id)"
          >
            {{ revealedIds[item.id] ? '要点メモを隠す' : '要点メモを表示する' }}
          </button>

          <p
            v-if="revealedIds[item.id]"
            class="mt-2 whitespace-pre-wrap rounded-lg bg-indigo-50/60 p-2.5 text-xs text-slate-800"
          >
            {{ item.answerOrNote }}
          </p>
        </div>

        <div class="mt-3 grid grid-cols-3 gap-2">
          <button
            type="button"
            :disabled="props.loading"
            class="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
            @click="handleGrade(item.id, 'again')"
          >
            もう一度
          </button>
          <button
            type="button"
            :disabled="props.loading"
            class="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
            @click="handleGrade(item.id, 'hard')"
          >
            曖昧
          </button>
          <button
            type="button"
            :disabled="props.loading"
            class="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
            @click="handleGrade(item.id, 'good')"
          >
            完璧
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
