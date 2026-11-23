# GEMINI.md — Cross-Project Engineering Constitution

## 1. Project Context Discovery (Architecture-Agnostic)
このファイルはプロジェクト横断の普遍ルールを定義する。
プロジェクト固有の技術スタック・ディレクトリ構成・検証コマンド・命名規約は、必ず以下を一次情報として参照すること：
- プロジェクトルートの設定・マニフェスト（`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Makefile`, `README.md` 等）
- `.agents/rules/` 配下のプロジェクト固有ルール
- プロジェクトの設計ドキュメント

---

## 2. Non-Negotiable Rules

### 2.1 Secrets & Sensitive Data Protection
- `.env`, `.env.local`, `.env.*`（テンプレートである `.env.example` / `.env.template` を除く）、APIキー、トークン、秘密鍵ファイルを絶対に読取・出力・ハードコード・コミットしない。
- 秘密鍵・外部APIキー・DB特権キーは必ずサーバー／バックエンド境界に隔離し、クライアント公開バンドル（例: `PUBLIC_*`, `NEXT_PUBLIC_*`, `NUXT_PUBLIC_*`, `VITE_*` 等）へ絶対に混入させない。
- 個人情報（PII）や健康・機微データは最小権限で扱い、外部LLM／外部APIへ不要な個人識別情報を送信しない。

### 2.2 Impact Analysis in Plans
- UI・API・データモデル・スキーマ・AIプロンプト入出力を変更する計画では、以下への影響を必ず明記する：
  1. 共通型定義・バリデーションスキーマ・API契約
  2. 認証・認可境界およびデータアクセス制御（RLS / ミドルウェア等）
  3. 外部API／DB／LLM 障害時のエラーハンドリング方針

### 2.3 No Production Dummy Fallback (Fail-Closed)
- 本番コードパスにおいて、API / DB / LLM 呼び出しの失敗や必須環境変数の欠落時に、ダミーデータ・モック値・サイレント成功へフォールバックしてはならない。
- 障害時は Fail-Closed を原則とし、明示的なエラー伝播とユーザーへの安全な状態通知を行う。

### 2.4 Cost & Resource Efficiency
- 外部API・LLM呼び出しでは、不要なループ呼び出し・無制限ポーリング・バックオフなしのリトライを避け、適切なタイムアウト・出力上限・キャッシュ設計を行う。
- DBクエリでは N+1 問題や不要な全件スキャンを回避し、フロントエンドでは不要な再フェッチ・過剰な再描画を防ぐ。

### 2.5 Mandatory Plan Review Before Approval
- 機能実装・仕様変更・リファクタリング・バグ修正の実装計画を作成したら、ユーザーへ承認を求める**前**に必ず `plan-reviewer` サブエージェント（`review-plan` スキル）で以下3観点を監査する：
  1. Security
  2. No Production Dummy Fallback
  3. Cost & Resource Efficiency
- `NG` の場合は最大2回まで自己修正・再監査を行い、未解決のトレードオフがある場合はユーザーへ提示する。計画末尾に必ず **Plan Review Summary** を付記する。

### 2.6 Verification Before Completion
- コードの作成・編集完了後、完了報告を行う**前**に `test-verifier` サブエージェント（`verify-project` スキル）を実行し、変更スコープに応じた検証コマンド（typecheck / lint / test / build 等、対象リポジトリの定義に従う）が `PASS` することを確認する。
- 実行していないコマンドを成功と偽らない。型エラーや lint 警告の安易な抑制（`@ts-ignore`, `eslint-disable` 等）は原則禁止とする。

### 2.7 Model Tier Separation (Plan vs Implementation)
- 調査・設計・実装計画の作成は親エージェント（UI選択モデル）で行う。
- 計画承認後のコード実装・編集・テスト作成は、ユーザー方針に基づき `implementer` サブエージェントへ委譲し、呼び出し時は **`Model: "flash_lite"` を明示指定**する。
- 実装完了後の検証は引き続き `test-verifier`（`flash`）で実施する。

