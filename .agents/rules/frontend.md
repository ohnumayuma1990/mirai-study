---
trigger: glob
globs:
  - "pages/**/*"
  - "components/**/*"
  - "composables/**/*"
  - "layouts/**/*"
  - "middleware/**/*"
  - "app.vue"
description: Vue 3 / Nuxt 3 フロントエンド層の型安全、Composables責務分離、SSR/Auth整合、描画・再フェッチ最適化、エラー表示ルール
---

# Frontend Rules (MiraiBody / Vue 3 + Nuxt 3)

## 1. Type-Safe Vue 3 Composition API
- すべての SFC で `<script setup lang="ts">` を使用し、`defineProps<Props>()` および `defineEmits<Emits>()` は型引数で厳密に定義する。
- `any` の使用および `@ts-ignore` / `@ts-expect-error` による安易な型抑制を禁止する。
- API 入出力の型は `shared/schemas/` から参照し、フロントエンド側で重複定義しない。

## 2. Separation of Concerns (Composables)
- データ取得・認証・画像リサイズ（Canvas 強制再エンコード EXIF 除去）・フォーム検証・状態変換・グラフ用データ整形などのロジックは `composables/` へ抽出し、コンポーネント（`pages/`, `components/`）はプレゼンテーションとユーザー操作のバインディングに集中させる。
- コンポーネントから直接 Firestore / Cloud Storage / OpenAI API へアクセスせず、必ず Nuxt の `server/api/**`（Bearer ID Token 付き）を経由する。

## 3. Explicit Loading, SSR Alignment & Error States (No Fake Fallback UI)
- Firebase Auth はクライアント側でセッション解決するため、保護ルートの `middleware/auth.ts` は SSR 側リダイレクトを抑止し、認証必須 `useAsyncData` は `{ server: false, immediate: false }` でクライアント認証確定後のみ実行する。
- 非同期処理・API 呼び出し時は、`authLoading` / `pending` / `error` / `needs_setup` / `data` の状態を明示的に UI へ反映する。
- API 障害時・設定欠落時・データ未取得時に、架空の体組成値・ダミー予測グラフ・仮ログインを表示してはならない。ユーザーに状況と再試行・設定手段を安全に案内する。

## 4. Rendering & Refetch Efficiency
- 3シナリオ予測グラフや KPI 等の派生データは `computed` で適切にメモ化し、テンプレート内の重いインライン計算を避ける。
- Nuxt の `useFetch` / `useAsyncData` では明確なキャッシュキーを指定し、不要な重複フェッチや無制限のポーリングを行わない。
- `watch` / `watchEffect` の副作用で意図しない無限ループや過剰な API 呼び出しが発生しないよう、依存配列と重複実行ガードを管理する。
