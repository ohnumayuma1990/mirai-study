# MiraiStudy

資格試験・プログラミング技術習得＆3シナリオ未来予測・忘却曲線AIエージェントアプリ（Nuxt 3 フルスタック構成 / GCP 常時無料枠 + OpenAI Vision 最適化 / AI ROZA SSO・A2A v1.0 対応）

## ドキュメント

- [現行実装の詳細設計書](./docs/detailed-design.md)
- [要件定義書 & 実装計画 (`docs/implementation-plan.md`)](./docs/implementation-plan.md)

## 技術スタック
- **フレームワーク**: Nuxt 3（Vue 3 + TypeScript Strict + Nitro Server）
- **スタイリング**: Tailwind CSS (`@nuxtjs/tailwindcss`)
- **グラフ描画**: Chart.js + `vue-chartjs`（3シナリオ学習予測ファンチャート）
- **バリデーション / 共通契約**: Zod (`shared/schemas/`)
- **インフラ（GCP Always Free 最適化）**:
  - **Cloud Run**: Nuxt 3 / Nitro コンテナ（`min-instances=0`, `max-instances=2`, 512MiB）
  - **Cloud Firestore**: `users/{uid}/...` サブコレクション構造
  - **Firebase Authentication**: メール／パスワード認証 & AI ROZA SSO
  - **Cloud Storage**: 非公開バケット
- **AI Engine**: OpenAI API（Vision + Structured Outputs `json_schema` strict モード、デフォルト `gpt-4.1-mini`）
- **テスト / Lint**: Vitest, `@nuxt/eslint`, `nuxt typecheck`

## 主な機能（MiraiBody 横展開）
1. **複数テーマ（トラック）管理 (`StudyTrack`)**:
   - 資格試験（AWS資格、応用情報技術者など）と技術習得（TypeScript、フルスタック開発など）をテーマごとに切り替え管理。
2. **3シナリオ未来予測シミュレーター (`shared/domain/simulation.ts`)**:
   - 実績トレンド（`observed_trend`）、目標学習ペース（`target_pace`）、集中＋復習完走ペース（`intensive_pace`）の3シナリオで試験日までの予測得点率・累積学習時間をファンチャート表示。
3. **4種の学習記録 & エビングハウス忘却曲線・復習キュー**:
   - **学習セッション記録 (`study_sessions`)**: 学習時間[分]、カテゴリ、教材・トピック、集中度
   - **演習・模試スコア記録 (`exam_logs`)**: 得点率(%)、正答数/問題数、苦手論点タグ
   - **開発・ハンズオン進捗 (`dev_logs`)**: 完了タスク数、成果物メモ、習得技術タグ
   - **復習キューアイテム (`review_items`)**: 1日後→3日後→7日後→14日後→30日後の忘却曲線ステージ管理
4. **Vision 画像解析インジェスト**:
   - `exam_result_ocr`（模試・過去問結果画面OCR）、`study_material_photo`（参考書・ノートからの要点＆復習カード抽出）、`study_timer_ocr`（学習タイマー・進捗画面OCR）
5. **AI ROZA (Hub) SSO & A2A v1.0 連携 (`a2a:miraistudy`)**:
   - チャットからの学習記録ドラフト生成（HITL フォーム）、QuickSheet 4タブ表示、AI 学習コーチング。
