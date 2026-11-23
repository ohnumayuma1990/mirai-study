# MiraiStudy — 要件定義書 & 実装計画（MiraiBody 横展開プロジェクト）

## 1. プロジェクト概要と目的
[miraibody](file:///home/antigravity/ohnumayuma1990/miraibody) のフルスタック Nuxt 3 + GCP Always Free + OpenAI Vision Structured Outputs + AI ROZA (SSO / A2A v1.0) アーキテクチャを横展開し、**資格試験・受験勉強**と**プログラミング・技術習得**を両立する学習記録＆未来予測AIエージェントアプリ **`MiraiStudy`**（リポジトリ名: `mirai-study`）を新規構築する。

---

## 2. MiraiBody からのドメイン横展開マッピング

| 機能領域 | MiraiBody（体組成・栄養管理） | MiraiStudy（資格試験・技術習得管理） |
| :--- | :--- | :--- |
| **基本ターゲット管理** | `profile/goals`（目標体重・期日・基礎代謝） | **`tracks/{trackId}`（複数テーマ・トラック切り替え型）**<br>例：「AWS SAA資格」「基本情報技術者」「TypeScript実装」ごとに目標スコア/目標学習時間・試験日/期限日を管理 |
| **コア未来予測エンジン** (`shared/domain/simulation.ts`) | 摂取カロリーと動的BMR/NEATから3シナリオ（現状トレンド/推奨ペース/集中ペース）の体重推移・マイルストーン予測 | **学習時間＆演習スコア3シナリオ未来予測**<br>1. `observed_trend`（直近14〜45日の実績学習時間・正答率トレンド回帰）<br>2. `target_pace`（1日目標学習分数を維持した場合の合格ライン到達予測）<br>3. `intensive_pace`（+30〜50%集中ペース＋復習消化による早期到達シナリオ）<br>※ 忘却減衰と学習収穫逓減（習熟度が高まるほど1点あたりの必要時間が増えるロジスティック/減衰曲線）を純粋関数でモデル化 |
| **記録種別①（実績推移・主指標）** | `body_composition_logs`（体重・体脂肪率・筋肉量） | **`exam_logs`（演習・模試・過去問スコア記録）**<br>得点率(%) / スコア、正答数/問題数、対象分野、苦手論点タグ、移動平均スコア推移 |
| **記録種別②（日々のインプット）** | `meal_logs`（食事カロリー・PFC・品目） | **`study_sessions`（学習セッション記録）**<br>学習時間(分)、トラックID、教材・トピック名、カテゴリ（インプット講義/問題演習/コーディング/復習）、集中度(1-5)、メモ |
| **記録種別③（日次アウトプット/行動）** | `activity_logs`（歩数・活動消費・出社/在宅） | **`dev_logs`（開発・ハンズオン進捗ログ）**<br>実装機能・完了タスク数、成果物/コミットメモ、習得技術タグ（`tags`）、ハンズオン分数 |
| **記録種別④（新規コア機能）** | なし | **`review_items`（エビングハウス忘却曲線・復習キュー）**<br>学習・演習やVision解析から抽出した重要論点・苦手単元を登録。復習段階（Stage 0〜5: 1日後 → 3日後 → 7日後 → 14日後 → 30日後）と `nextReviewDate` を管理し、理解度評価（もう一度 / 曖昧 / 完璧）で次回間隔を自動更新 |
| **Vision 画像解析** (`server/utils/openai.ts`) | `meal_photo` / `tanita_ocr` / `asken_ocr` | **3種類の学習特化 Vision インジェスト**<br>1. `exam_result_ocr`（模試・過去問アプリ・Webテスト結果画面からスコア・分野別正答率・苦手論点を抽出）<br>2. `study_material_photo`（参考書・問題集・ノート・技術書の写真から単元名・要約・復習キュー候補カードを自動抽出）<br>3. `study_timer_ocr`（Studyplus / タイマー / GitHub草 / エディタ画面等のスクショから学習時間・進捗を抽出） |
| **AI ROZA 連携** (SSO & A2A v1.0) | `a2a:miraibody` / QuickSheet 4タブ / HITL記録確認 | **`a2a:miraistudy` (`A2A_AGENT_ID = 'miraistudy'`)**<br>- **QuickSheet 4タブ**: `未来予測` / `学習セッション` / `演習・模試` / `復習キュー＆開発`<br>- **HITL フォーム**: チャットや画像添付から学習セッション・模試結果・開発進捗・復習カードのドラフトを生成し確認保存 |

---

## 3. 要件定義詳細

### 3.1 複数テーマ（トラック）管理 (`StudyTrack`)
- ユーザーは複数の学習トラック（例：「応用情報技術者試験」「TOEIC 800点」「Next.js/Nuxt フルスタック開発」）を作成・切り替え可能（上限 20 トラック）。
- 各トラックは以下の属性を持つ：
  - `id`, `title`, `category` (`certification` | `programming` | `language` | `general`)
  - `targetDate`（試験日・目標達成期限日: ISO Date）
  - `targetScorePct`（目標得点率 0〜100%、資格・試験系で重視）
  - `passingScorePct`（合格基準ライン 0〜100%、デフォルト 70%）
  - `targetTotalHours`（目標総学習時間 [時間]、技術習得・試験勉強共通の完走目安）
  - `dailyGoalMinutes`（1日あたり目標学習時間 [分]、スライダーで What-If シミュレーション可能）
  - `isDefault`（ダッシュボード初期表示トラック）

### 3.2 3シナリオ未来予測シミュレーター (`shared/domain/simulation.ts`)
- **入力**: 選択中トラックの目標設定 (`StudyTrack`)、学習セッション履歴 (`study_sessions`)、演習・模試ログ (`exam_logs`)、未消化の期限切れ復習アイテム数 (`overdueReviewCount`)。
- **出力 (`SimulationResponse`)**:
  - データ不足時はダミー値を返さず `status: 'needs_setup'` と不足項目 (`missing`) を返す（**Fail-Closed**）。
  - データ充足時は `status: 'ready'` を返し、以下を計算：
    1. **累積学習時間 & 予測習熟度スコア(%) の日次ポイント配列 (`points`)**
    2. **3シナリオ予測 (`scenarios`)**:
       - `observed_trend`: 直近実績の1日平均学習時間とスコア伸び率（OLS回帰＋収穫逓減補正）から予測される目標期日時点の到達スコア(%)・達成予定日
       - `target_pace`: 設定した1日目標学習分数（スライダー変更値 `dailyMinutesOverride` 対応）を継続した場合の予測曲線
       - `intensive_pace`: 1日目標の 1.35倍 ＋ 復習キューを遅延なく消化（定着率ボーナス）した場合の予測曲線
    3. **忘却ペナルティ & 復習アラート (`retentionAlert`)**:
       - 期限切れ復習アイテムが溜まっている場合、予測スコアの実効定着率に対する減衰警告と「今日優先すべき復習件数」を提示。

### 3.3 エビングハウス忘却曲線・復習キュー (`review_items`)
- 復習間隔ステージ：`STAGE_INTERVAL_DAYS = [1, 3, 7, 14, 30, 60]`
- 各アイテムは `trackId`, `topic`, `questionOrPrompt`（確認ポイント）, `answerOrNote`（要点メモ）, `stage` (0〜5), `nextReviewDate` (YYYY-MM-DD), `lastReviewedAt`, `status` (`active` | `mastered`) を保持。
- 復習アクション (`POST /api/reviews/[id]/grade`):
  - `again`（忘れた）: `stage = 0`, `nextReviewDate = 明日`
  - `hard`（曖昧）: `stage` 据え置き（最低1日後〜現在ステージ間隔の半分）
  - `good`（定着）: `stage = min(stage + 1, 5)`, `nextReviewDate = 今日 + STAGE_INTERVAL_DAYS[nextStage]`（Stage 5 完了時は `status = 'mastered'`）

### 3.4 画面構成（モバイルファースト・下部ナビゲーション付き Nuxt 3 構成）
1. **`/` (Dashboard & Future Simulator)**:
   - 上部トラック切り替えピル（アクティブな学習テーマをワンタップ切替）
   - KPI サマリーカード（累積学習時間 / 直近模試・演習推定スコア / 試験日までの残り日数＆合格予測判定 / 本日の復習キュー件数）
   - 1日学習時間スライダー（30分〜360分）による **What-If 3シナリオ未来予測ファンチャート**
   - 本日の復習キュー（Due Today）クイック消化ウィジェット
2. **`/ingest` (Vision AI インジェスト)**:
   - ブラウザ Canvas リサイズ（長辺 1280px）＆ EXIF 除去
   - `exam_result_ocr` / `study_material_photo` / `study_timer_ocr` の3モード解析
   - 解析結果から「演習スコア記録」「学習セッション記録」「復習カード一括登録」を編集・確認して保存
3. **`/logs` (記録・復習キュー・トラック目標管理)**:
   - 学習セッション登録フォーム / 演習・模試スコア登録フォーム / 開発・ハンズオン進捗フォーム
   - 復習キュー一覧＆フラッシュカード復習UI
   - トラック（学習テーマ）新規作成・目標編集フォーム
4. **`/login` & `/auth/sso/callback`**:
   - Firebase Auth ログインおよび AI ROZA Hub からの SSO コールバック

---

## 4. 新規作成リポジトリ・ファイル構成一覧

GitHub リポジトリ `ohnumayuma1990/mirai-study` を新規作成（`/home/antigravity/ohnumayuma1990/mirai-study` にマウント）し、以下のファイルを構築する：

- **プロジェクト設定・インフラ・ルール**:
  - `package.json`, `nuxt.config.ts`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs`
  - `Dockerfile`, `firestore.rules`, `storage.rules`, `.env.example`, `.gitignore`
  - `GEMINI.md`, `.agents/rules/security-and-secrets.md`, `.agents/rules/architecture-and-Coding.md`, `.agents/agents/plan-reviewer.md`, `.agents/agents/test-verifier.md`
  - `scripts/gcp-setup-and-deploy.sh`, `README.md`
- **共通スキーマ & ドメイン (`shared/`)**:
  - `shared/schemas/track.ts`（学習トラック・目標スキーマ）
  - `shared/schemas/study-session.ts`（学習セッション記録スキーマ）
  - `shared/schemas/exam-log.ts`（演習・模試スコア記録スキーマ）
  - `shared/schemas/dev-log.ts`（開発・ハンズオン進捗スキーマ）
  - `shared/schemas/review-item.ts`（忘却曲線・復習キュースキーマ）
  - `shared/schemas/simulation.ts`（3シナリオ学習予測スキーマ）
  - `shared/schemas/vision.ts`（学習画像解析 Structured Outputs スキーマ）
  - `shared/schemas/a2a.ts`（`a2a:miraistudy` スキーマ）
  - `shared/schemas/sso.ts`, `shared/schemas/health.ts`
  - `shared/domain/simulation.ts`（3シナリオ学習時間・スコア予測＆忘却曲線計算エンジン）
- **サーバーサイド (`server/`)**:
  - `server/utils/firebase-admin.ts`, `server/utils/auth.ts`, `server/utils/sso.ts`
  - `server/utils/a2a-auth.ts`, `server/utils/a2a-body.ts`, `server/utils/signed-token.ts`
  - `server/utils/image-validation.ts`, `server/utils/rate-limit.ts`, `server/utils/request-ip.ts`
  - `server/utils/openai.ts`（学習系3種 Vision 解析 + 構造化出力プロンプト）
  - `server/domain/miraistudy-service.ts`, `server/domain/record-task.ts`
  - `server/api/health.get.ts`, `server/api/simulation.get.ts`
  - `server/api/tracks.get.ts`, `server/api/tracks.put.ts`
  - `server/api/study-sessions.get.ts`, `server/api/study-sessions.post.ts`
  - `server/api/exam-logs.get.ts`, `server/api/exam-logs.post.ts`
  - `server/api/dev-logs.get.ts`, `server/api/dev-logs.post.ts`
  - `server/api/reviews.get.ts`, `server/api/reviews.post.ts`, `server/api/reviews/grade.post.ts`
  - `server/api/ingest/vision.post.ts`, `server/api/ingest/upload.delete.ts`
  - `server/api/auth/sso/consume.post.ts`
  - `server/api/a2a/v1.post.ts`, `server/ api/a2a/tasks/[id]/commit.post.ts`, `server/api/a2a/tasks/[id]/cancel.post.ts`
  - `server/routes/.well-known/agent-card.json.get.ts`
- **フロントエンド (`composables/`, `components/`, `pages/`, `layouts/`, `middleware/`)**:
  - `composables/useFirebaseAuth.ts`, `composables/useApiFetch.ts`, `composables/useImageResize.ts`, `composables/useDashboard.ts`, `composables/useVisionIngest.ts`, `composables/useHealthCheck.ts`
  - `components/KpiSummaryCards.vue`, `components/FutureSimulatorChart.vue`, `components/ReviewQueueCard.vue`, `components/TrackGoalsForm.vue`, `components/StudyLogForms.vue`
  - `pages/index.vue`, `pages/ingest.vue`, `pages/logs.vue`, `pages/login.vue`, `pages/auth/sso/callback.vue`
  - `layouts/default.vue`, `middleware/auth.ts`, `app.vue`
- **テスト (`tests/`)**:
  - `tests/schemas.test.ts`, `tests/simulation.test.ts`, `tests/openai.test.ts`, `tests/auth.test.ts`, `tests/auth-boundary.test.ts`, `tests/image-validation.test.ts`, `tests/rate-limit.test.ts`, `tests/sso.test.ts`, `tests/a2a.test.ts`, `tests/health.test.ts`

---

## 5. Impact Analysis（影響分析・非交渉ルール準拠）

### 5.1 共通型定義・バリデーションスキーマ・API契約への影響
- フロントエンドと Nitro サーバー間の全入出力は `shared/schemas/*.ts` の Zod v4 `strictObject` スキーマを単一の真実の源（Single Source of Truth）として共有する。
- OpenAI Structured Outputs (`json_schema` strict: true) 用の JSON Schema も `shared/schemas/vision.ts` と完全一致させ、すべてのプロパティを `required`（任意項目は nullable）として定義する。
- AI ROZA Hub 連携用の A2A v1.0 契約は `A2A_AUDIENCE = 'a2a:miraistudy'`, `A2A_AGENT_ID = 'miraistudy'` として定義し、QuickSheet / UI Cards / HITL Form の拡張 URI (`urn:roza:*:v1`) 互換性を100%維持する。

### 5.2 認証・認可境界およびデータアクセス制御への影響
- **Firestore & Cloud Storage 多層防御**:
  - `firestore.rules` および `storage.rules` はクライアント直接アクセスを全面拒否 (`allow read, write: if false;`) とする。
  - 全データアクセスは Nitro サーバー API を経由し、`requireAuthUser(event)` で Firebase ID Token を検証（SSO 有効時は `sso_at` クレームの1時間鮮度も検証）した `uid` に基づき `users/{uid}/...` サブコレクションのみを読み書きする。
- **Storage パス境界**:
  - 画像の保存パスは `assertOwnedImagePath(uid, path)` (`users/{uid}/{ingestType}/{file}`) および `assertOwnedStagingPath(uid, path)` (`staging/{uid}/{taskId}.{ext}`) で厳格に検証し、他ユーザーのオブジェクト参照やパストラバーサルを遮断する。
- **シークレット隔離**:
  - `NUXT_OPENAI_API_KEY`, `NUXT_SSO_SHARED_SECRET`, `NUXT_A2A_SHARED_SECRET`, `NUXT_A2A_CALLERS_JSON` はサーバー専用 `runtimeConfig` に閉じ込め、`runtimeConfig.public` には Firebase 公開設定と `ssoEnabled` のみを配置する。
- **PII / プロンプトインジェクション対策**:
  - 画像はブラウザ側 Canvas で長辺 1280px に再エンコードして EXIF（GPS 等）を完全除去し、サーバー側でも Magic Bytes 検証＋上限 4MB チェックを実施する。
  - ユーザーメモを OpenAI に渡す際は UID・メールアドレスのマスクと `<user_note>` タグエスケープを実施し、システム指示の上書きを防止する。

### 5.3 外部API / DB / LLM 障害時のエラーハンドリング方針（Fail-Closed）
- **No Production Dummy Fallback**:
  - Firebase Admin 未設定・Firestore 接続失敗・OpenAI API キー欠落または呼び出しエラー時に、モックデータやダミー予測グラフ、仮の解析結果へフォールバックすることは一切行わない。
  - 初期データ未登録時（トラック未設定、または学習・演習ログ不足時）は `status: 'needs_setup'` を明示返却し、UI 上で初期設定ガイドを表示する。
- **コスト・リソース保護**:
  - Vision 解析エンドポイント (`/api/ingest/vision`) および A2A エンドポイントにはユーザー/IP 単位のスライディングウィンドウ・レート制限 (`rate-limit.ts`) を適用する。
  - OpenAI 呼び出しには `AbortSignal.timeout(25_000)` と `max_output_tokens: 900` を設定し、リトライループを禁止する。
  - Firestore クエリは `.select(...)` プロジェクションと `.limit(...)` を必須とし、`Promise.all` で並列取得することで N+1 クエリとフルスキャンを防止する。


---

## Plan Review Summary
- **Overall Verdict**: `PASS`
- **1. Security**: `PASS` — シークレットのサーバー専用 `runtimeConfig` 隔離、`firestore.rules` / `storage.rules` 全拒否＋Nitro ID Token 検証、`users/{uid}/...` と Storage パス境界検証、Zod v4 `strictObject` + OpenAI `strict: true`、Canvas EXIF 除去と `<user_note>` エスケープを完備。
- **2. No Production Dummy Fallback**: `PASS` — Firebase / Firestore / OpenAI 障害時や未設定時にダミー値へフォールバックしない Fail-Closed 設計、および初期データ不足時の `status: 'needs_setup'` 明示返却を定義。
- **3. Cost & Resource Efficiency**: `PASS` — Vision / A2A レート制限、OpenAI タイムアウト (25s)・出力トークン上限 (900)・リトライループ禁止、1280px リサイズ、Firestore `.select()` + `.limit()` + `Promise.all` による N+1 / フルスキャン防止を定義。
- **Revisions Applied**: 初回監査でPASS
