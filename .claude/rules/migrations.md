---
description: Drizzle のマイグレーションを生成したら必ずローカル D1 に適用する
paths:
  - "migrations/**"
  - "src/server/db/schema.ts"
  - "drizzle.config.ts"
---

# マイグレーションの規則

## 生成したら必ず適用する

```
npm run db:generate
npm run db:migrate:local
```

生成だけで止めない。コードは新しいスキーマを前提に動くので、適用しないとローカル D1 に列が無いまま
画面が落ちる。走行中のクローラーがあれば、サーバーだけが新スキーマに切り替わり取り込みが記録なしに失敗する。

## 共有テーブルを変えるとき

`voice_actors` / `audio_works` / `store_listings` / `audio_credits` / `crawl_runs` はクローラーとサーバーの
両方が使う。変える前に他のセッションが長時間バッチを動かしていないかを確かめる
(確認方法は `CLAUDE.md` の「ローカルの共有資源」)。動いていたら終わるまで待つ。待てないなら nullable な列の追加にとどめる。

## 検出と remote

- `npm run check` の先頭で `check:migrations` が未適用を検出する
- 同じ検査が hook からも走る (`.claude/settings.json` / `.claude/hooks/migrations-guard.mjs`)。
  ターンを終える前 (Stop)、`migrations/*.sql` か `schema.ts` を編集した直後、`db:generate` を実行した直後
- 検査はローカル D1 の sqlite を読み取り専用で開くだけで、クロール中でも安全
- remote (本番 D1) への適用は `CLAUDE.md` の「本番に触る操作」に従う
