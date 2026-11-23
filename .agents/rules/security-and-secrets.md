---
trigger: model_decision
description: シークレット・環境変数・Nuxt runtimeConfig 境界・Firebase Auth / Firestore / Cloud Storage 認証認可・個人健康データ（体組成・食事写真・栄養ログ）を扱う際のセキュリティルール
---

# Security & Secrets Rules (MiraiBody / Nuxt 3 + GCP Always Free + OpenAI)

## 1. Secrets & `.env` Protection
- `.env`, `.env.local`, `.env.*`（テンプレートである `.env.example` を除く）は絶対に読取・出力・ログ記載・コミットしない。
- 環境変数の追加・変更時は必ず `.env.example` にキー名と用途コメントのみ（実値なし）を追記する。

## 2. Nuxt 3 Server / Client Boundary (`runtimeConfig`)
- 以下の秘密情報・サーバー専用設定は**必ずサーバー専用 `runtimeConfig`（非 `public`）** に隔離し、Nitro サーバー層（`server/**`）以外から参照しない：
  - `NUXT_OPENAI_API_KEY`（`runtimeConfig.openaiApiKey`）
  - `NUXT_OPENAI_MODEL`（`runtimeConfig.openaiModel`）
  - `NUXT_GCP_PROJECT_ID`（`runtimeConfig.gcpProjectId`）
  - `NUXT_GCS_BUCKET_NAME`（`runtimeConfig.gcsBucketName`）
  - `NUXT_GCP_CLIENT_EMAIL` / `NUXT_GCP_PRIVATE_KEY`（ローカル開発時任意。Cloud Run 本番は ADC を優先し静的鍵レス運用）
- `runtimeConfig.public`（`NUXT_PUBLIC_*`）には、ブラウザに公開しても安全な Firebase Web Config（`NUXT_PUBLIC_FIREBASE_API_KEY`, `NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NUXT_PUBLIC_FIREBASE_PROJECT_ID`）のみを配置する。
- `firebase-admin` は `server/**` のみからインポートし、フロントエンドバンドルへ絶対に混入させない。

## 3. Authentication, Authorization & Multi-Layer Access Control
- `firestore.rules` および `storage.rules` ではクライアントからの直接読み書きを全拒否（`allow read, write: if false;`）し、全データ操作を Nitro サーバー API 経由に強制する。
- `server/api/**` の保護エンドポイント（`GET /api/health` 以外すべて）では、必ず `Authorization: Bearer <idToken>` を `firebase-admin` の `verifyIdToken(token, true)`（失効検証込み）で検証し、未認証または失効リクエストは `401` で Fail-Closed 拒否する。
- クライアント指定の `uid` / `userId` は一切信頼・受付せず、検証済み `uid` に厳密バインドした Firestore パス（`users/{uid}/...`）および Cloud Storage プレフィックス（`users/{uid}/...`）のみを操作する。
- `imagePath` を受け取るすべてのエンドポイント（`POST /api/meals`, `POST /api/body-logs`, `DELETE /api/ingest/upload`）では、リテラルプレフィックス照合＋厳格な UUID パス検証（`assertOwnedImagePath`）を必須実行する。

## 4. Health & PII Data Protection
- 体組成・食事写真・健康目標は機微な個人データ（PII / Health Data）として扱う。
- アップロード画像は元サイズに関わらずクライアント側で必ず `<canvas>` 再エンコードし、GPS 位置情報やカメラ端末情報等の EXIF PII を除去してから送信する。
- OpenAI API 等の外部 LLM へ送信するペイロードには、氏名・メールアドレス・Firebase `uid`・年齢等の直接識別子を一切含めず、解析に必要な画像と最小限の食事メモのみを渡す。
- ユーザー入力（食事メモ等）は `</user_note>` 等の閉じタグを無害化した上で `<user_note>...</user_note>` 構造化境界へ隔離し、`system` ロール指示と明確分離してプロンプトインジェクションを防止する。
- エラーログやクライアント返却エラーにスタックトレース・生トークン・API キー・画像バイナリ・機微データを含めない。
