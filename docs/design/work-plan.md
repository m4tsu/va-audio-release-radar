# 作業計画と進行記録

Date: 2026-09-18 (夜間の自律作業)
方針: 設計・タスク分割・レビューは上流担当 (Fable)、実装は下位モデルのサブエージェントが行う。

## タスク一覧

| ID | 内容 | 依存 | 担当モデル | 状態 |
|---|---|---|---|---|
| T0 | 最小セットアップ (Vite / React / TanStack Router / Tailwind / Biome / Vitest / Playwright / Wrangler) | - | - | 完了 |
| T1 | `src/domain/` 型・正規化・名寄せ・カテゴリ判定 + テスト | - | sonnet | 完了 |
| T2 | `crawler/` DLsite / Audible adapter、fetch ラッパー、fixtures、CLI (`actor` / `diff`) | T1 | opus | 完了 (5 人で実取得成功。残課題: Audible 302 を「0 件成功」扱いに変更、domain の import に `.ts` 拡張子を付けて Node 直接実行可能にする → T5 で対応) |
| T3 | TanStack Start (SSR) 移行、Cloudflare Workers 設定、D1 + Drizzle スキーマとマイグレーション、`/api/health` | T1 (設定ファイルの競合回避のため) | opus | 完了 (D1 `voice-actor-audio-release-radar` を作成、ローカルのみマイグレーション適用) |
| T4a | `src/server/` 読み取りクエリ、`POST /api/admin/ingest`、`sitemap.xml` / `robots.txt`、管理用 server functions | T3 | opus | 完了 (テスト 52 件追加、libsql インメモリでテスト) |
| T4b | 画面: `/`、`/voice-actors/$slug`、`/works/$id`、`/following`、`/admin/*`、フォロー状態 (Zustand + Dexie)、E2E | T4a | opus | 完了 (E2E 12 件。残課題: canonical が相対パス → `SITE_URL` で絶対化) |
| R1 | `src/**` の読み取り専用レビュー (セキュリティ・SSR・データ整合) | T4a, T4b | opus | 完了 (下記「R1 の指摘」) |
| T5 | シード声優リスト (35 人、AniList で ID 確認)、`crawler/run.ts` (ingest 送信)、GitHub Actions cron、T2 残課題、ローカル D1 への全件クロール | T2, T4a | opus | 完了 (35 人全員 AniList 一致。listing 427 件、verified credit 487、名寄せ取りこぼし 0) |
| T6 | R1 指摘の修正、T5 申し送り (vite watch 除外、`status`、別名、`voice_by` の `\|` 分割、カテゴリ規則の見直し)、画面のスクリーンショット | R1, T5 | opus | 完了 (単体 178 件 / E2E 14 件。カテゴリ判定は実データ 200 件の集計で決め直し → architecture.md §4) |
| T7 | 作品ページのクレジット重複排除 (表記違いで同じ声優が 2 回出る)、再生時間不明の行を非表示、ローカル D1 のテストデータ削除と E2E 後の自動クリーンアップ | T6 | sonnet | 完了 (単体 185 件 / E2E 14 件) |

## 最終状態 (2026-09-18 06:00 頃)

- `npm run check` (型・lint・単体 185 件)、`npm run build`、`npm run test:e2e` (14 件)、`wrangler deploy --dry-run` すべて通過
- ローカル D1: 声優 35、作品 424、listing 424、credit 1493 (テストデータは削除済み)
- git: 初期化のみ。コミットは 0 件 (全ファイルが未追跡)。本番デプロイ・remote へのマイグレーション適用は未実施

## 次にやること (候補)

1. ユーザー確認後にコミット → GitHub リポジトリ作成 → `npm run deploy` → `npm run db:migrate:remote` → 本番 D1 へ初回クロール (`INGEST_URL` を本番に向けて `radar:crawl`)
2. 企画書 Milestone 5: アフィリエイト URL (`store_listings.affiliate_url`) の生成。アフィリエイト ID が入ってから
3. 企画書 Nice-to-have: AniList の「Known for」(anilistStaffId は全員分入っている)、既読 / 未読、週次ダイジェスト
4. カテゴリ判定の取りこぼし (ジャンル「歴史/時代物」のみの連作ドラマ 8 件) の扱い
5. `voice_actors` が 100 人を超える前に、管理画面の一覧・検索のページングを確認する

## R1 の指摘 (T6 で修正) — 12 項目すべて対応済み

重大:
- D1 の bound parameter 上限は 100。`SQL_IN_CHUNK_SIZE = 200` (works.ts / admin.ts) と、分割していない `loadSampleWorks` (admin.ts)・`searchActors` (actors.ts) は 100 件超で失敗する。libsql のテストでは検知できない → 90 に下げ、全 IN 句を分割

中:
- JSON-LD (`voice-actors.$slug.tsx`) が `dangerouslySetInnerHTML` 相当で埋め込まれる → `JSON.stringify` 後に `<` を `\u003c` にエスケープ
- `productUrl` / `coverImageUrl` にスキーム検証がない → zod で `https:` 限定、描画側も `https` 以外は出さない
- ingest の credit upsert が unmatched で既存の手動割り当てを上書きする → unmatched のときは既存値を保持

軽微:
- canonical が相対パス → `SITE_URL` (wrangler `vars`) で絶対化
- `?token=` を検証せず cookie に入れる → `ADMIN_TOKEN` 一致時のみ Set-Cookie
- `timingSafeEqual` が長さ不一致で早期 return → 長さも定数時間で扱う
- `getWorkById` だけ `adult` を絞っていない
- `upsertWork` が `adult` を更新しない
- `releaseDate` に `YYYY-MM-DD` の形式検証がない
- `fetchPopularActors` が未使用のまま公開されている → 削除
- ingest が作品ごとに逐次 SQL を発行 (30 作品で約 150 往復) → `db.batch` でまとめる (将来課題でも可)

問題なし: import protection、SSR / hydration の一致、管理系の認可、企画書 §7 の原則

## T5 のクロール結果 (2026-09-18 深夜、ローカル D1)

| 指標 | 値 |
|---|---|
| store_listings (dlsite / audible) | 202 / 225 |
| audio_credits (verified / unmatched) | 487 / 1012 (unmatched はすべて追跡対象外の共演者) |
| crawl_runs | ok 75、error 0 |
| DLsite 0 件 | 男性声優と一部の女性声優 |
| Audible 該当なし (empty) | 水瀬いのり、小倉唯、石見舞菜香、楠木ともり、市ノ瀬加那、種﨑敦美 |

企画書 §37 の GO / NO-GO のうち「DLsite / Audible の抽出が 20 人で安定」「名寄せ精度」は 1 回目のクロールで満たした。「日次クローラーが 7 日以上生き残る」は GitHub Actions 稼働後に判定する。

## ユーザーが行う必要があること (翌朝以降)

1. GitHub リポジトリの作成と push (定期クローラーを GitHub Actions で動かすため)。
   ワークフローは `.github/workflows/crawl.yml` (毎日 05:00 JST + `workflow_dispatch`)。
   リポジトリの Secrets に次の 2 つを入れる:
   - `INGEST_URL`: デプロイ先のオリジン (例 `https://voice-actor-audio-release-radar.<account>.workers.dev`)。
     末尾にパスは付けない。`run.ts` が `/api/admin/actors` などを足す
   - `INGEST_TOKEN`: 下の 2. で Cloudflare に入れるものと**同じ値**。ここがずれると取り込みが 401 になる
2. Cloudflare に秘匿値を登録: `npx wrangler secret put INGEST_TOKEN`, `npx wrangler secret put ADMIN_TOKEN`
   (ローカルの `vite dev` は `.dev.vars` を読むので、この登録は本番用)
3. 本番デプロイの判断 (`npm run deploy`)。夜間作業ではデプロイもコミットもしない
4. アフィリエイト登録 (DLsite アフィリエイト、Amazon アソシエイト) — Milestone 5 で必要

## 確認済みの外部条件 (2026-09-18)

- Cloudflare: wrangler ログイン済み (account id 22a094315813df5b583e86fcc338d11d)。D1 は作成可能
- GitHub: gh ログイン済み (m4tsu)
- DLsite / Audible / AniList への到達性: `docs/design/architecture.md` §3

## 2026-09-18 日中の決定と進行中の作業

### 決定 (設計書 §9〜§14 に詳細)

| 論点 | 決定 |
|---|---|
| 対象声優 | AniList にアニメ出演がある声優 2,569 人。手書きリストを廃止し自動生成 |
| 取得方針 | 声優起点。sitemap の全件取得はしない (27 倍のコスト差) |
| 新着 | 発売日基準。フィードは 3 段。back catalog が主内容 |
| 差別化の軸 | 出演形態 (単独 / 少人数 / 全編朗読 / 大人数) |
| 年齢区分 | **全年齢 + BL**。R18 は載せない (実利ゼロ + Amazon アソシエイトのリスク) |
| 次のストア | **ポケットドラマ CD** (斉藤壮馬 143 件。既存 2 ストアが取りこぼす男性声優とドラマ CD の本流) |
| audiobook.jp | 規約 第15条(15) の照会が前提。**ユーザーが照会を実施**。返信待ちの間はポケドラを進める |
| 別名義 | 信頼できる情報に基づく場合のみ紐付ける。DLsite からは根拠が得られないと実測で確認 |

### ユーザーが行うこと

1. audiobook.jp (オトバンク) への照会。文面は `docs/research/otobank-inquiry-draft.md`。埋めるのは氏名・メールアドレス・サービス名・サービス URL
2. 返信内容の共有 (許可 / 条件付き / 不許可で進め方が変わる)
3. 本番デプロイ・Cloudflare の秘匿値登録・GitHub Secrets (未実施)
4. アフィリエイト登録 (DLsite、Amazon アソシエイト)

### 次の作業

1. 上位 500 人のスイープ (2〜4 時間)。T14 完了後に開始
2. ポケットドラマ CD の adapter 実装 (一般 + BL の 2 区分。年齢確認・Cookie 不要)
3. `AudioWork.adult: boolean` を年齢区分の列挙に変更する
4. 出演形態の分類をドメイン層に追加する
