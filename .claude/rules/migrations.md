---
description: Drizzle のマイグレーションを生成したら必ずローカル D1 に適用する
paths:
  - "migrations/**"
  - "src/server/db/schema.ts"
  - "drizzle.config.ts"
---

# マイグレーションの規則

## 生成したら必ず適用する

`npm run db:generate` でマイグレーションを生成したら、**続けて適用まで実行する**。

```
npm run db:generate
npx wrangler d1 migrations apply DB --local     # = npm run db:migrate:local
```

生成だけで止めない。「あとで当てる」は許さない。

## なぜか

コードは新しいスキーマを前提に動く。適用しないと、ローカル D1 に列が無いまま
コードがその列を参照し、画面が落ちる。実行中のクロールがあれば、
サーバーだけが新スキーマに切り替わって取り込みが**静かに失敗する**。

**これは実際に 2 回起きた**。1 回目は 4.5 時間ぶんのクロール結果が保存されず、
ingest が HTTP 400 のときは `crawl_runs` に行すら作られないため気付けなかった。
経緯は [`docs/design/decisions.md`](../../docs/design/decisions.md) の §14 にある。

## 共有テーブルを変えるとき

`voice_actors` / `audio_works` / `store_listings` / `audio_credits` / `crawl_runs` は
クローラーとサーバーの両方が使う。スキーマを変える前に、
他のセッションが長時間バッチを動かしていないか `crawl_runs` の最新行で確認する。

```
npx wrangler d1 execute DB --local --command \
  "select started_at, finished_at, store_slug, status from crawl_runs order by started_at desc limit 5"
```

最新行の `finished_at` が NULL で `started_at` が直近なら、動いている可能性が高い。
その場合は**終わるまで待つ**。待てないなら、少なくとも
**nullable な列の追加にとどめる**（既存の行と、走行中のクローラーが送る形を壊さないため）。

## 検出と remote

- `npm run check` の先頭で `npm run check:migrations` が未適用を検出する。落ちたら適用する
- 同じ検査が hook からも走る（`.claude/settings.json` / `.claude/hooks/migrations-guard.mjs`）
  - **ターンを終える前に必ず**（Stop）。未適用のままだと終了できない
  - `migrations/*.sql` か `src/server/db/schema.ts` を編集した直後（PostToolUse / Edit・Write）
  - `db:generate` や `drizzle-kit generate` を実行した直後（PostToolUse / Bash）
- 検査はローカル D1 の sqlite を読み取り専用で開くだけで、書き込みはしない。
  クロール中でも安全に走る
- **remote（本番 D1）には勝手に適用しない**。`npm run db:migrate:remote` はユーザーの判断で実行する
