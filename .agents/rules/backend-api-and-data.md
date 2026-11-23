---
trigger: glob
globs:
  - "server/**/*"
  - "shared/**/*"
description: Nitro サーバーAPI・共通スキーマ/型定義・Firestore/Cloud Storage/OpenAI API連携層の設計、Zod検証、Fail-Closed、コスト効率ルール
---

# Backend API, Schema & Data Rules (MiraiBody / Nuxt 3 Nitro + GCP + OpenAI)

## 1. Shared Contracts & Validation (Zod)
- API リクエスト・レスポンス・AI 構造化出力の契約は `shared/schemas/` に Zod スキーマとして定義し、型定義は `z.infer` で単一ソース化する。
- `server/api/**` のすべてのエンドポイントでは、入力（query / params / body / multipart）を Zod で検証し、不正入力は `createError({ statusCode: 400, statusMessage: ... })` で明示的に拒否する。

## 2. No Production Dummy Fallback (Fail-Closed)
- 本番コードパスにおいて、Firestore・Cloud Storage・Firebase Auth・OpenAI API 呼び出し失敗時や必須環境変数（`runtimeConfig.gcpProjectId`, `gcsBucketName`, `openaiApiKey` 等）欠落時に、ダミーデータ・固定モック・サイレント成功を返してはならない。
- 必須設定の欠落時は明示的な `503` エラーを投げ、上流 API 障害時は `502`/`504` を返して呼び出し元へ安全に障害状態を伝播させる。
- テスト用モックはテストファイル（`tests/**`）内に厳格に閉じ込める。

## 3. OpenAI API & External Resource Cost Efficiency
- OpenAI API 呼び出しには必ず以下を適用する：
  - 明示的な **タイムアウト**（`AbortSignal.timeout(25_000)`）
  - **最大出力トークン上限**（`max_completion_tokens: 1024`）と Structured Outputs（`json_schema`, `strict: true`）の指定
  - マルチモーダル画像解析では、送信前に Canvas 強制リサイズ＆EXIF 除去、サーバー側で 4MB / MIME / マジックバイト / ヘッダピクセル寸法（4096×4096・16MP）上限検証を実施する
  - ループ内での連続 LLM 呼び出しを禁止し、リトライは `429` / `503` のみ最大 1 回ジッター付きバックオフとする
  - ユーザー単位の TTL＋上限付きレート制限と、OpenAI 解析成功後にのみ Cloud Storage へ書き込む処理順により無駄な I/O・孤立オブジェクトを防止する

## 4. Firestore Query & Simulation Discipline
- Firestore クエリは必ず `users/{uid}/...` サブコレクション配下に限定し、`.orderBy(...).limit(limit)` と必要なフィールドのみの `.select(...)` 射影を指定して不要な全件スキャン・過剰読込を防ぐ。
- ループ内クエリ（N+1 問題）を禁止し、複数コレクション取得は `Promise.all` 等で並列化する。
- 未来予測シミュレーションの日次ループおよび目標日には `MAX_SIMULATION_DAYS = 730` のハード上限を適用する。
