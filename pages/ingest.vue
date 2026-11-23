<script setup lang="ts">
import type { VisionIngestType } from '../shared/schemas/vision'

definePageMeta({
  middleware: ['auth'],
})

const { user, authLoading } = useFirebaseAuth()
const { tracks, selectedTrackId, loadTracks } = useDashboard()
const { apiFetch } = useApiFetch()
const {
  resizedImage,
  ingestResult,
  analyzing,
  saving,
  error,
  prepareImage,
  runAnalysis,
  discardUploadedImage,
} = useVisionIngest()

const ingestType = ref<VisionIngestType>('exam_result_ocr')
const userNote = ref('')
const saveFeedback = ref<string | null>(null)
const saveError = ref<string | null>(null)

watch(
  () => [authLoading.value, user.value?.uid],
  ([loading, uid]) => {
    if (!loading && uid) {
      loadTracks()
    }
  },
  { immediate: true },
)

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  saveFeedback.value = null
  saveError.value = null
  await prepareImage(file)
}

async function handleAnalyze(): Promise<void> {
  saveFeedback.value = null
  saveError.value = null
  await runAnalysis({
    ingestType: ingestType.value,
    trackId: selectedTrackId.value,
    userNote: userNote.value,
  })
}

async function handleSaveAnalysis(): Promise<void> {
  if (!ingestResult.value || !selectedTrackId.value) {
    saveError.value = '保存先の学習トラックを選択してください。'
    return
  }

  saving.value = true
  saveError.value = null
  saveFeedback.value = null
  const today = new Date().toISOString().slice(0, 10)
  const { analysis, imagePath } = ingestResult.value

  try {
    if (analysis.ingestType === 'exam_result_ocr') {
      await apiFetch('/api/exam-logs', {
        method: 'POST',
        body: {
          trackId: selectedTrackId.value,
          takenDate: analysis.takenDate ?? today,
          examName: analysis.examName,
          scorePct: analysis.scorePct,
          ...(analysis.correctCount !== null ? { correctCount: analysis.correctCount } : {}),
          ...(analysis.totalQuestions !== null ? { totalQuestions: analysis.totalQuestions } : {}),
          ...(analysis.domainArea ? { domainArea: analysis.domainArea } : {}),
          weakTopics: analysis.weakTopics,
          memo: analysis.summary,
          imagePath,
        },
      })
      if (analysis.reviewCards.length > 0) {
        await apiFetch('/api/reviews', {
          method: 'POST',
          body: {
            items: analysis.reviewCards.map((c) => ({
              trackId: selectedTrackId.value!,
              topic: c.topic,
              questionOrPrompt: c.questionOrPrompt,
              answerOrNote: c.answerOrNote,
            })),
          },
        })
      }
      saveFeedback.value = `模試スコアと復習カード ${analysis.reviewCards.length} 件を保存しました。`
    } else if (analysis.ingestType === 'study_timer_ocr') {
      await apiFetch('/api/study-sessions', {
        method: 'POST',
        body: {
          trackId: selectedTrackId.value,
          studiedDate: analysis.studiedDate ?? today,
          durationMinutes: analysis.durationMinutes,
          materialOrTopic: analysis.materialOrTopic,
          category: analysis.category,
          focusLevel: analysis.focusLevel,
          memo: analysis.summary,
          imagePath,
        },
      })
      saveFeedback.value = '学習セッションを保存しました。'
    } else {
      if (analysis.estimatedDurationMinutes) {
        await apiFetch('/api/study-sessions', {
          method: 'POST',
          body: {
            trackId: selectedTrackId.value,
            studiedDate: today,
            durationMinutes: analysis.estimatedDurationMinutes,
            materialOrTopic: analysis.materialOrTopic,
            category: analysis.category,
            focusLevel: 4,
            memo: analysis.keySummary,
            imagePath,
          },
        })
      }
      if (analysis.reviewCards.length > 0) {
        await apiFetch('/api/reviews', {
          method: 'POST',
          body: {
            items: analysis.reviewCards.map((c) => ({
              trackId: selectedTrackId.value!,
              topic: c.topic,
              questionOrPrompt: c.questionOrPrompt,
              answerOrNote: c.answerOrNote,
            })),
          },
        })
      }
      saveFeedback.value = `教材ノート解析結果と復習カード ${analysis.reviewCards.length} 件を保存しました。`
    }
    ingestResult.value = null
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : '保存に失敗しました。'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-5">
    <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h1 class="text-lg font-bold text-slate-900">Vision AI 画像インジェスト</h1>
      <p class="mt-1 text-xs text-slate-500">
        ブラウザ上で長辺 1280px へリサイズ・EXIF 完全除去した上で OpenAI Vision Structured Outputs で解析します。
      </p>

      <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label class="block text-xs font-medium text-slate-700">
          対象トラック
          <select
            v-model="selectedTrackId"
            class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option v-if="tracks.length === 0" :value="null">トラック未作成</option>
            <option v-for="t in tracks" :key="t.id" :value="t.id">{{ t.title }}</option>
          </select>
        </label>

        <label class="block text-xs font-medium text-slate-700">
          解析モード
          <select
            v-model="ingestType"
            class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="exam_result_ocr">模試・過去問結果画面 OCR</option>
            <option value="study_material_photo">参考書・ノート写真（要点＆復習カード抽出）</option>
            <option value="study_timer_ocr">学習タイマー・Studyplus スクショ OCR</option>
          </select>
        </label>
      </div>

      <label class="mt-3 block text-xs font-medium text-slate-700">
        補足メモ (任意・個人情報不要)
        <input
          v-model="userNote"
          type="text"
          maxlength="300"
          placeholder="例: AWS SAA セクション3の演習結果"
          class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
        >
      </label>

      <label class="mt-3 block text-xs font-medium text-slate-700">
        画像ファイルを選択 (JPEG / PNG / WEBP)
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          class="mt-1 block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-indigo-700"
          @change="onFileChange"
        >
      </label>

      <div v-if="resizedImage" class="mt-4 space-y-2">
        <img
          :src="resizedImage.previewUrl"
          alt="解析プレビュー"
          class="max-h-64 rounded-xl border border-slate-200 object-contain"
        >
        <p class="text-[11px] text-slate-500">
          EXIF除去済み: {{ resizedImage.width }} × {{ resizedImage.height }}px ({{ Math.round(resizedImage.blob.size / 1024) }} KB)
        </p>
      </div>

      <button
        type="button"
        :disabled="!resizedImage || analyzing"
        class="mt-4 w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        @click="handleAnalyze"
      >
        {{ analyzing ? 'Vision AI で解析中...' : '画像を解析する' }}
      </button>

      <p v-if="error" class="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{{ error }}</p>
      <p v-if="saveError" class="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{{ saveError }}</p>
      <p v-if="saveFeedback" class="mt-3 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-700">{{ saveFeedback }}</p>
    </div>

    <!-- Parsed Result Confirmation Card -->
    <div v-if="ingestResult" class="rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm">
      <h2 class="text-base font-bold text-slate-900">解析結果の確認</h2>
      <pre class="mt-3 max-h-80 overflow-auto rounded-xl bg-slate-900 p-3 text-xs text-slate-100">{{ JSON.stringify(ingestResult.analysis, null, 2) }}</pre>

      <div class="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          :disabled="saving || !selectedTrackId"
          class="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          @click="handleSaveAnalysis"
        >
          {{ saving ? '保存中...' : 'この内容で記録を保存' }}
        </button>
        <button
          type="button"
          :disabled="saving"
          class="rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          @click="discardUploadedImage"
        >
          破棄して画像を削除
        </button>
      </div>
    </div>
  </div>
</template>
