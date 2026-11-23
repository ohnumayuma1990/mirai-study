<script setup lang="ts">
import type { StudyTrack } from '../shared/schemas/track'
import type { StudyCategory, StudySessionInput } from '../shared/schemas/study-session'
import type { ExamLogInput } from '../shared/schemas/exam-log'
import type { DevLogInput } from '../shared/schemas/dev-log'

interface Props {
  tracks: StudyTrack[]
  selectedTrackId: string
  saving?: boolean
}

interface Emits {
  (e: 'submit-session', payload: StudySessionInput): void
  (e: 'submit-exam', payload: ExamLogInput): void
  (e: 'submit-dev', payload: DevLogInput): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const activeTab = ref<'session' | 'exam' | 'dev'>('session')
const today = new Date().toISOString().slice(0, 10)

// Study session form
const studiedDate = ref(today)
const durationMinutes = ref(60)
const materialOrTopic = ref('')
const category = ref<StudyCategory>('practice')
const focusLevel = ref(4)
const sessionMemo = ref('')

// Exam log form
const takenDate = ref(today)
const examName = ref('')
const scorePct = ref(72)
const correctCount = ref<number | undefined>(undefined)
const totalQuestions = ref<number | undefined>(undefined)
const domainArea = ref('')
const weakTopicsText = ref('')

// Dev log form
const loggedDate = ref(today)
const featureSummary = ref('')
const completedTasks = ref(1)
const handsOnMinutes = ref(60)
const tagsText = ref('')
const commitOrArtifactNote = ref('')

function submitSession(): void {
  if (!props.selectedTrackId) return
  emit('submit-session', {
    trackId: props.selectedTrackId,
    studiedDate: studiedDate.value,
    durationMinutes: Number(durationMinutes.value),
    materialOrTopic: materialOrTopic.value.trim(),
    category: category.value,
    focusLevel: Number(focusLevel.value),
    ...(sessionMemo.value.trim() ? { memo: sessionMemo.value.trim() } : {}),
  })
  materialOrTopic.value = ''
  sessionMemo.value = ''
}

function submitExam(): void {
  if (!props.selectedTrackId) return
  const weakTopics = weakTopicsText.value
    .split(/[,、\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
  emit('submit-exam', {
    trackId: props.selectedTrackId,
    takenDate: takenDate.value,
    examName: examName.value.trim(),
    scorePct: Number(scorePct.value),
    ...(correctCount.value !== undefined && !Number.isNaN(correctCount.value)
      ? { correctCount: Number(correctCount.value) }
      : {}),
    ...(totalQuestions.value !== undefined && !Number.isNaN(totalQuestions.value)
      ? { totalQuestions: Number(totalQuestions.value) }
      : {}),
    ...(domainArea.value.trim() ? { domainArea: domainArea.value.trim() } : {}),
    weakTopics,
  })
  examName.value = ''
  weakTopicsText.value = ''
}

function submitDev(): void {
  if (!props.selectedTrackId) return
  const tags = tagsText.value
    .split(/[,、\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
  emit('submit-dev', {
    trackId: props.selectedTrackId,
    loggedDate: loggedDate.value,
    featureSummary: featureSummary.value.trim(),
    completedTasks: Number(completedTasks.value),
    handsOnMinutes: Number(handsOnMinutes.value),
    tags,
    ...(commitOrArtifactNote.value.trim()
      ? { commitOrArtifactNote: commitOrArtifactNote.value.trim() }
      : {}),
  })
  featureSummary.value = ''
  commitOrArtifactNote.value = ''
}
</script>

<template>
  <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div class="mb-4 flex gap-2 border-b border-slate-100 pb-3">
      <button
        type="button"
        class="rounded-xl px-3 py-1.5 text-xs font-semibold"
        :class="activeTab === 'session' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'"
        @click="activeTab = 'session'"
      >
        学習セッション
      </button>
      <button
        type="button"
        class="rounded-xl px-3 py-1.5 text-xs font-semibold"
        :class="activeTab === 'exam' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'"
        @click="activeTab = 'exam'"
      >
        演習・模試スコア
      </button>
      <button
        type="button"
        class="rounded-xl px-3 py-1.5 text-xs font-semibold"
        :class="activeTab === 'dev' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'"
        @click="activeTab = 'dev'"
      >
        開発・ハンズオン
      </button>
    </div>

    <p v-if="!selectedTrackId" class="text-xs text-amber-600">
      先に学習トラックを作成・選択してください。
    </p>

    <form v-else-if="activeTab === 'session'" class="space-y-3" @submit.prevent="submitSession">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label class="block text-xs font-medium text-slate-700">
          学習日
          <input v-model="studiedDate" type="date" required class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
        </label>
        <label class="block text-xs font-medium text-slate-700">
          学習時間 (分)
          <input v-model.number="durationMinutes" type="number" min="1" max="1440" required class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
        </label>
        <label class="block text-xs font-medium text-slate-700">
          教材・トピック
          <input v-model="materialOrTopic" type="text" required placeholder="例: VPCネットワーキング章末問題" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
        </label>
        <label class="block text-xs font-medium text-slate-700">
          カテゴリ
          <select v-model="category" class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="lecture">インプット講義</option>
            <option value="practice">問題演習</option>
            <option value="coding">コーディング</option>
            <option value="review">復習</option>
          </select>
        </label>
        <label class="block text-xs font-medium text-slate-700">
          集中度 (1〜5)
          <input v-model.number="focusLevel" type="range" min="1" max="5" class="mt-2 w-full">
          <span class="text-xs text-slate-500">{{ focusLevel }} / 5</span>
        </label>
        <label class="block text-xs font-medium text-slate-700">
          メモ (任意)
          <input v-model="sessionMemo" type="text" placeholder="気づきや次回の課題" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
        </label>
      </div>
      <button type="submit" :disabled="saving" class="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
        {{ saving ? '保存中...' : '学習セッションを記録' }}
      </button>
    </form>

    <form v-else-if="activeTab === 'exam'" class="space-y-3" @submit.prevent="submitExam">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label class="block text-xs font-medium text-slate-700">
          受験日
          <input v-model="takenDate" type="date" required class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
        </label>
        <label class="block text-xs font-medium text-slate-700">
          模試・演習名
          <input v-model="examName" type="text" required placeholder="例: Udemy模擬試験 第2回" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
        </label>
        <label class="block text-xs font-medium text-slate-700">
          得点率 (%)
          <input v-model.number="scorePct" type="number" min="0" max="100" step="0.1" required class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
        </label>
        <label class="block text-xs font-medium text-slate-700">
          対象分野 (任意)
          <input v-model="domainArea" type="text" placeholder="例: セキュリティ・IAM" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
        </label>
        <label class="block text-xs font-medium text-slate-700">
          正答数 (任意)
          <input v-model.number="correctCount" type="number" min="0" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
        </label>
        <label class="block text-xs font-medium text-slate-700">
          総問題数 (任意)
          <input v-model.number="totalQuestions" type="number" min="1" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
        </label>
      </div>
      <label class="block text-xs font-medium text-slate-700">
        苦手論点タグ (カンマ区切り)
        <input v-model="weakTopicsText" type="text" placeholder="例: KMS, Direct Connect, IAMロール" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
      </label>
      <button type="submit" :disabled="saving" class="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
        {{ saving ? '保存中...' : '演習・模試スコアを記録' }}
      </button>
    </form>

    <form v-else class="space-y-3" @submit.prevent="submitDev">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label class="block text-xs font-medium text-slate-700">
          記録日
          <input v-model="loggedDate" type="date" required class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
        </label>
        <label class="block text-xs font-medium text-slate-700">
          ハンズオン時間 (分)
          <input v-model.number="handsOnMinutes" type="number" min="0" max="1440" required class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
        </label>
        <label class="block text-xs font-medium text-slate-700">
          実装機能・成果物サマリー
          <input v-model="featureSummary" type="text" required placeholder="例: Nuxt Nitro APIのZod厳格検証を実装" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
        </label>
        <label class="block text-xs font-medium text-slate-700">
          完了タスク数
          <input v-model.number="completedTasks" type="number" min="0" max="500" required class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
        </label>
      </div>
      <label class="block text-xs font-medium text-slate-700">
        習得技術タグ (カンマ区切り)
        <input v-model="tagsText" type="text" placeholder="例: TypeScript, Nuxt3, Zod, CloudRun" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
      </label>
      <label class="block text-xs font-medium text-slate-700">
        コミット / 成果物メモ (任意)
        <input v-model="commitOrArtifactNote" type="text" placeholder="PRメモや学んだポイント" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
      </label>
      <button type="submit" :disabled="saving" class="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
        {{ saving ? '保存中...' : '開発・ハンズオン進捗を記録' }}
      </button>
    </form>
  </div>
</template>
