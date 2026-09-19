# 作業計画と進行記録

方針: 設計・タスク分割・レビューは上流担当 (Fable)、実装は下位モデルのサブエージェントが行う。

この文書はタスクの進行記録と、人が手を動かす必要があることの一覧。
**設計の現状は [`architecture.md`](./architecture.md)、決定の経緯は [`decisions.md`](./decisions.md)。**

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

## T7 (夜間作業) 終了時点での積み残し

記録。現在の作業は末尾の「次の作業」を見る。

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
- DLsite / Audible / AniList への到達性: [`architecture.md`](./architecture.md) §6

## 2026-09-18 日中の決定と進行中の作業

### 日中のタスク (T8〜T15 / A1〜A8)

夜間の T0〜T7 と違い、日中は個別の起票を残していない。成果物から確認できる範囲で次のとおり。

| ID | 内容 | 成果物 |
|---|---|---|
| T8 | Audible の空白入り別名フォールバック (検証済み → 未検証の順に候補を試す) | `crawler/adapters/audible.ts`, `crawler/lib/ingest.ts` |
| T9 | 発見スパイク (AniList × DLsite sitemap の交差) | `docs/research/discovery-spike-2026-09-18.md`, `crawler/discovery/run.ts` |
| T10 | フィードの 3 段構成、`freshness`、未読 | `src/server/queries/works.ts`, `src/app/routes/index.tsx` |
| T11 | Audible の `sort=pubdate-desc-rank` 対応 | `crawler/adapters/audible.ts` |
| T12 | 網羅率 (`totalCount` / `coverageComplete`) と古い順での補完 | `crawler/adapters/coverage.ts`, `crawl_runs` の 2 列 |
| T13 | 対象声優の自動生成、作品 0 件の声優をページ・一覧・sitemap から外す | `crawler/discovery/actor-entity.ts`, `crawler/actors.generated.json` |
| T14 | 生成規則の修正 (1 語名義を除外しない、姓の切り方を名前の長さで変える) | 同上 |
| T15 | `adult: boolean` → `ageRating` の列挙、`storeSection` の追加 | `src/domain/types.ts`, `src/server/db/schema.ts`, `migrations/` |

| ID | 調査 | 成果物 |
|---|---|---|
| A1 / A2 | Audible の「該当なし」302 の検証 (頻度制限ではなく検索結果 0 件であることの確認) (推測: 起票の粒度は記録が無い) | `architecture.md` §6 の Audible |
| A3 | Audible の並び順パラメータの実測 | `architecture.md` §6 の Audible |
| A4 | DLsite のページング上限の実測 (`per_page` は無視される、`pager.count` が取れる) | `decisions.md` §4 |
| A5 | ストア横断調査 | `docs/research/store-survey-2026-09-18.md` |
| A6 | 年齢区分の実利調査 | `docs/research/adult-scope-2026-09-18.md` |
| A7 | オトバンクへの照会の窓口と文面 | `docs/research/otobank-inquiry-draft.md` |
| A8 | ポケドラのフィクスチャ収集と取得仕様の確定 | `architecture.md` §6 のポケットドラマ CD, `decisions.md` §12 |

### 決定

2026-09-18 日中のブレストと調査で決めたことは [`decisions.md`](./decisions.md) にまとめてある
(対象声優の自動生成、声優起点の取得、発売日基準の新着、出演形態への差別化、全年齢 + BL、
次のストアはポケドラ、audiobook.jp の規約照会、別名義の原則)。ここには要約を置かない。
2 箇所に書くと片方だけ古くなるため。

### ユーザーが行うこと

1. audiobook.jp (オトバンク) への照会。文面は `docs/research/otobank-inquiry-draft.md`。埋めるのは氏名・メールアドレス・サービス名・サービス URL
2. 返信内容の共有 (許可 / 条件付き / 不許可で進め方が変わる)
3. 本番デプロイ・Cloudflare の秘匿値登録・GitHub Secrets (未実施)
4. アフィリエイト登録 (DLsite、Amazon アソシエイト)

### 次の作業

実行中 (別セッション。どちらもプロセス単位のレート制限を使うので、**同じストアへ同時に出ない**こと):

| | 内容 | 状態 |
|---|---|---|
| S1 | 上位 500 人のスイープ (DLsite / Audible)。対象声優の厚みを実データで測る | 実行中 (2〜4 時間) |
| S2 | ポケドラの声優タグ辞書の構築 (`crawler/discovery/pokedora-tags.ts`、声優タグ 3,161 件) | 実行中。所要時間の見積もりは [`../stores/pokedora.md`](../stores/pokedora.md) の「全件クロールのコスト」 |

S1 / S2 が終わってから着手するもの:

1. S2 の辞書を AniList 対象声優と交差させる (`crawler/discovery/pokedora-intersect.ts`)。
   ネットワークに出ないので S2 の完了直後に回せる
2. ポケットドラマ CD の adapter 実装 (一般 + BL の 2 区分。年齢確認・Cookie 不要)。
   `StoreSlug` に `pokedora` を追加する。取得仕様は `architecture.md` §6
3. 出演形態 (単独 / 少人数 / 全編朗読 / 大人数) の分類をドメイン層に追加する
4. S1 の結果で GO / NO-GO の厚み (音声作品が 1 本以上ある対象声優の人数、1 人あたりの作品総数) を判定する

いつでも着手できるもの:

5. カテゴリ判定の取りこぼし (ジャンル「歴史/時代物」のみの連作ドラマ 8 件) の扱い
6. `voice_actors` が 100 人を超える前に、管理画面の一覧・検索のページングを確認する
7. 通知の設計 (OAuth 登録、フォローのサーバー同期、週次ダイジェスト。`architecture.md` §9)

完了済み:

- `AudioWork.adult: boolean` → `ageRating` の列挙 (T15 で対応済み)
