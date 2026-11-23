# MiraiStudy 詳細設計書

資格試験や技術習得のトラックごとに学習時間、模試結果、開発実績、復習項目を管理する。記録から3種類の学習ペースを試算し、復習期日と定着率への影響を表示する。AI ROZA Hub からは SSO と学習サマリー照会を利用できる。基準は [`main` の実装コミット](https://github.com/ohnumayuma1990/mirai-study/tree/23500266dd785a80e345ffd516580d69ab0a9997)。

## 1. 構成と責務

| 層 | 実装と責務 |
| --- | --- |
| Web | Nuxt 3／Vue 3／Tailwind CSS。ページとコンポーネントで入力・復習・グラフを表示。Composables が認証後の取得、アップロード、Canvas 再エンコードを担う |
| API | Nitro が認証、入力検証、外部連携を受け持つ。画面/API で Zod スキーマと型を共有する |
| ドメイン | `miraistudy-service.ts` が Firestore の保存・集約、`record-task.ts` が外部書き込み用ドラフト、`shared/domain/simulation.ts` がスコア予測と復習間隔を扱う |
| 外部サービス | Firebase Auth／Firestore／非公開 Cloud Storage と OpenAI。Hub は SSO コード発行元かつ読み取り A2A クライアント |

[Nuxt 設定](../nuxt.config.ts) · [Firestore サービス](../server/domain/miraistudy-service.ts) · [共有スキーマ](../shared/schemas)

## 2. 画面と操作

| パス | 操作と状態 |
| --- | --- |
| `/login` | SSO 有効時は Hub へ遷移。無効時は Firebase メール・パスワード |
| `/auth/sso/callback` | フラグメントを取り除き、コードを交換して Firebase にサインインする |
| `/` | 学習トラックを選択・設定し、KPI、3本の予測、要復習件数を表示する。学習時間の試算条件を変更し、復習結果を評価する |
| `/logs` | 学習時間・模試・開発実績を入力し、トラック別の履歴を確認する |
| `/ingest` | 模試結果、教材、タイマーの画像を解析し、内容を確認して学習記録・復習候補を保存する |

ブラウザ側で Firebase 認証状態を解決した後に保護 API を呼ぶ。ダッシュボードは取得中、取得失敗、初期データ不足、表示可能の状態を画面に反映する。

[ページ](../pages) · [ダッシュボード取得](../composables/useDashboard.ts) · [認証ミドルウェア](../middleware/auth.ts)

## 3. ブラウザ向け API

保護 API は Firebase の Bearer ID トークンを失効込みで検証する。Firestore のパスは検証済み UID で組み立てる。

| メソッドとパス | 入力 | 結果と副作用 |
| --- | --- | --- |
| GET `/api/health` | なし、公開 | `status, service, timestamp, checks`。Firebase Admin、GCS、OpenAI の設定有無を集約し、設定不足なら `degraded` |
| GET `/api/tracks` | なし | `{tracks,maxTracks}`。ユーザーごとの上限20 |
| PUT `/api/tracks` | トラック ID（任意）、分類、目標日・点数・時間、日次目標、既定フラグ | 作成または上書きし `{track}`。既定の切替をバッチで処理 |
| GET `/api/study-sessions` | 任意の `trackId,limit` | `{sessions}`。学習日の降順で既定60・上限180件 |
| POST `/api/study-sessions` | `StudySessionInput` | 学習時間・教材・集中度等を保存し `{session}` |
| GET `/api/exam-logs` | 任意の `trackId,limit` | `{logs}`。受験日の降順で既定60・上限180件 |
| POST `/api/exam-logs` | `ExamLogInput` | 模試名・スコア・弱点等を保存し `{log}` |
| GET `/api/dev-logs` | 任意の `trackId,limit` | `{logs}`。記録日の降順で既定60・上限180件 |
| POST `/api/dev-logs` | `DevLogInput` | 開発実績・完了件数・タグ等を保存し `{log}` |
| GET `/api/reviews` | 任意の `trackId,status,dueOnly,limit` | 復習日の昇順、既定100・上限200件。復習カードと期日集計 |
| POST `/api/reviews` | 復習カード1件または `{items:[...]}` | 1〜20件の入力を受け付け、Firestore バッチで作成。複数入力は `{items}`、単体は `{item,items}` |
| POST `/api/reviews/grade` | `{id,grade}` | 次回日、ステージ、状態を更新し `{item}` |
| POST `/api/reviews/{id}/grade` | パスの ID と `{grade}` | 同じ復習評価サービスを呼ぶ |
| GET `/api/simulation` | 任意の `trackId,dailyMinutesOverride`。試算の分数は10〜720 | `ready` と3系列、または `needs_setup` と不足項目 |
| POST `/api/ingest/vision` | multipart の `image,ingestType,trackId?,userNote?` | 画像解析後に GCS 保存し `{imagePath,trackId,analysis}` |
| DELETE `/api/ingest/upload` | `{imagePath}` | 所有パスを検証し `{deleted:true,imagePath}`。すでに存在しない場合も成功 |
| GET `/api/auth/sso/start` | なし | state Cookie を作成して Hub へ302 |
| POST `/api/auth/sso/consume` | ブラウザが送る `{code,state}` と state Cookie | `{customToken,uid,ssoAt}` |

[API ハンドラー](../server/api) · [画像削除](../server/api/ingest/upload.delete.ts) · [ヘルスチェック](../server/api/health.get.ts)

## 4. データモデルと参照

| Firestore パス | 内容と制約 |
| --- | --- |
| `users/{uid}/tracks/{id}` | `title,category,targetDate,targetScorePct,passingScorePct,targetTotalHours,dailyGoalMinutes,isDefault` と作成・更新時刻。分類は資格・プログラミング・言語・一般。合格点は既定70 |
| `users/{uid}/study_sessions/{id}` | `trackId,studiedDate,durationMinutes,materialOrTopic,category,focusLevel` とメモ、任意の画像参照 |
| `users/{uid}/exam_logs/{id}` | `trackId,takenDate,examName,scorePct,correctCount,totalQuestions,domainArea,weakTopics` 等。正答数は総問題数以下 |
| `users/{uid}/dev_logs/{id}` | `trackId,loggedDate`、タスク、所要時間、完了件数、タグ等 |
| `users/{uid}/review_items/{id}` | `trackId,topic,questionOrPrompt,answerOrNote,nextReviewDate,stage,status` と評価情報。状態は `active` または `mastered` |
| `users/{uid}/a2a_tasks/{id}` | 外部書き込み用のドラフト種別、状態、値、任意の一時画像パスと時刻 |
| `sso_consumed_jtis/{sha256(jti)}` | SSO コードの消費記録と TTL 用の `expiresAt` |

予測は指定 ID、既定、一覧の先頭の順でトラックを選び、選択できる場合に対応する学習・模試（それぞれ最大180件）と active な復習（最大200件）を並列に読む。画像は `users/{uid}/{ingestType}/{uuid}.{ext}`、外部書き込みの一時画像は `staging/{uid}/{uuid}.{ext}` に置く。クライアントによる Firestore・Storage への直接アクセスは Rules で拒否する。

[学習サービス](../server/domain/miraistudy-service.ts) · [認証・画像所有権](../server/utils/image-validation.ts) · [Firestore Rules](../firestore.rules) · [Storage Rules](../storage.rules)

## 5. 予測と復習スケジュール

予測は UTC 日付で進める。トラック、または該当トラックの学習セッションと模試ログがともに欠ける場合、`needs_setup` を返す。現在スコアは直近3件までの模試の加重平均を優先する。模試がない場合、学習済み時間と目標時間の比から推定する。

| シナリオ | 1日あたりの学習時間と成長 |
| --- | --- |
| `observed_trend` | 直近30日を基準に実績平均を計算し、模試の OLS 傾向と期限切れ復習による減衰を反映する |
| `target_pace` | トラックの日次目標または試算値で、実績ペースより小さい忘却係数を適用する |
| `intensive_pace` | 目標ペースを1.35倍し、720分を上限にする |

スコア上昇は100%に近づくほど小さくなる。日次のスコアと累計時間を計算し、合格点に初めて達する日と目標日時点の見込みを返す。シミュレーションは最低14日、最大730日で、目標日の評価は計算できる範囲に収める。期限が当日以前の active カードは要復習、当日より前のカードは期限切れ。期限切れ1件につき1.2ポイント、最大18ポイントを定着率のペナルティとして用いる。

復習ステージの間隔は1、3、7、14、30、60日。 `again` はステージ0／翌日、`hard` はステージを維持して現間隔の半分（最低1日）、`good` は次のステージへ進める。最終ステージで `good` を選ぶと `mastered` になる。評価 API は保存済みカードのステージを読み、結果を更新する。

[予測・復習の計算](../shared/domain/simulation.ts) · [復習のスキーマ](../shared/schemas/review-item.ts)

## 6. SSO と A2A

### SSO

開始 API が Hub の HTTPS オリジン設定を検証し、64桁の state を5分の HttpOnly Cookie に保存して `/sso/miraistudy` に遷移する。Hub 発行の署名付きコードはフラグメントで復帰する。消費 API は署名、発行元、宛先 `sso:miraistudy`、期限、state と設定済みのアカウント対応を検証する。Hub の正規化済みメールを `NUXT_HUB_ACCOUNT_MAPPINGS_JSON` で既存 Firebase UID に解決し、Firestore のトランザクションで `jti` を一度だけ消費する。Firebase カスタムトークンには `sso_at` を含め、通常の保護 API は SSO 有効時に1時間の鮮度を適用する。SSO 鍵と A2A 鍵は別値を要求する。

[SSO 消費 API](../server/api/auth/sso/consume.post.ts) · [SSO 検証](../server/utils/sso.ts) · [アカウント解決](../server/utils/hub-account-mapping.ts)

### A2A と Hub の公開範囲

| インターフェース | 処理と制約 |
| --- | --- |
| GET `/.well-known/agent-card.json` | アプリ用 read Bearer で取得し、HMAC 署名を返す。設定した公開 HTTPS オリジンの `/api/a2a/v1`、`streaming:false`、`study_summary` を宣言 |
| POST `/api/a2a/v1` · `SendMessage` | A2A v1.0 の JSON-RPC 同期応答。ユーザー用 read Bearer でトラック・学習実績・予測・復習件数のサマリーを取得。任意の `metadata.trackId` を受け取る |
| 同上 · `quicksheet/get`、`tasks/get` | 互換処理として詳細タブまたはドラフト状態を取得 |
| 同上 · `message/send`、`tasks/cancel`／`CancelTask` | 互換書き込み。ドラフトを作成または取消 |
| POST `/api/a2a/tasks/{id}/commit`、`/api/a2a/tasks/{id}/cancel` | 互換書き込みの確定・取消。確定は種別と入力に応じたドメイン保存を呼ぶ |

A2A のユーザー識別には SSO と同じメールと UID の対応表を使う。互換書き込みは `NUXT_A2A_WRITE_ENABLED` と登録済みの呼び出し元が署名したトークンの write スコープを要求する。現行 Hub のカタログで公開する操作は read の同期チャットのみ。互換の確定処理は記録作成とタスクの `completed` 更新を個別に行うため、記録作成後の状態更新に失敗したときは再試行前に記録とタスクの両方を確認する必要がある。

[Agent Card](../server/routes/.well-known/agent-card.json.get.ts) · [A2A RPC](../server/api/a2a/v1.post.ts) · [A2A 認証](../server/utils/a2a-auth.ts) · [承認タスク](../server/domain/record-task.ts)

## 7. 画像解析、障害、運用

- 画像解析の種別は `exam_result_ocr`（結果・弱点・復習候補）、`study_material_photo`（要点と復習候補）、`study_timer_ocr`（日付・時間・教材・集中度）。ブラウザは Canvas で再エンコードし、サーバーは JPEG／PNG／WebP の実バイト、画像4 MiB、各辺4096・合計16,000,000画素の上限を検査する。互換 A2A の JSON 本文上限は6 MiB。
- OpenAI `gpt-4.1-mini` を既定モデルとし、25秒の期限と最大900出力トークンを設定する。メモのメールアドレス・UID 表記をマスクし、JSON Schema と Zod で解析結果を検証する。GCS は解析成功後に書く。
- 不正入力400、無効な資格情報401、認可・対応アカウント不足や連携無効403、対象不存在404、確定済みタスクとの競合409、容量超過413、頻度超過429。OpenAI の不正応答は502、タイムアウトは504、必須設定の欠損は503。Vision、SSO、A2A のリクエスト頻度をプロセス内で制限する。
- Cloud Run、Firebase プロジェクト、非公開バケット、サーバー専用設定の接続先は Nuxt runtime config とデプロイスクリプトで管理する。Firestore の TTL と複合インデックスは GCP 側の設定を確認する。 `/api/health` の各チェックは構成値の有無を示す。
- 主要な回帰確認は `tests/a2a.test.ts`（read／write と Card）、`tests/sso.test.ts`（state、鍵の分離、使い切り）、`tests/simulation.test.ts`（日数上限、復習、3系列）、`tests/openai.test.ts`（画像出力とエラー）。コマンドは `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build`。

[画像取込 API](../server/api/ingest/vision.post.ts) · [OpenAI クライアント](../server/utils/openai.ts) · [レート制限](../server/utils/rate-limit.ts) · [環境変数テンプレート](../.env.example) · [Cloud Run デプロイ](../scripts/gcp-setup-and-deploy.sh) · [テスト](../tests)
