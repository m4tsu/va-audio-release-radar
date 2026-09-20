---
description: E2E は専用の D1 とポートを使い、開発用の .wrangler/state を触らない
paths:
  - "e2e/**"
  - "playwright.config.ts"
---

# E2E の規則

## 専用の D1 を使う

E2E のローカル D1 は `.wrangler-e2e/state` に置き、開発用の `.wrangler/state` には読み書きしない。
開発用 D1 の位置づけは `CLAUDE.md` の「ローカルの共有資源」。

- `playwright.config.ts` が `webServer.env` で `RADAR_PERSIST_TO` を渡し、`vite.config.ts` がそれを
  `cloudflare({ persistState })` に渡す。wrangler CLI には `e2e/fixtures/e2e-db.mjs` が `--persist-to` で同じ値を渡す
- 固定データを入れるのは `npm run db:seed:e2e`。E2E 用 D1 にしか流れない
- `wrangler d1 execute DB --local` (`--persist-to` 無し) を E2E の文脈で書かない。開発用 DB を指す

## 専用のポートを使い、既存サーバーに相乗りしない

- ポートの値は `playwright.config.ts` が持つ。開発用 (`vite.config.ts`) や他のセッションと重ねない
- `reuseExistingServer` は false のまま。true にすると同じポートの他人の dev サーバーを掴み、
  開発用 D1 に固定データが流れ込む
- テスト内にポートを直書きしない。オリジンは `baseURL` から取る

## 固定データを開発用 DB に入れない

`e2e/fixtures/seed.sql` の行が開発用 DB に 1 件でも入ったら経路の設計が壊れている。消して済ませずに経路を直す。
E2E 用 D1 は毎回 `reset` してから作り直す (`e2e/fixtures/prepare.mjs`)。後片付け用の SQL は持たない。
消す処理を持つと、消す先を間違えたときに実データが飛ぶ。
