---
description: E2E は専用の D1 とポートを使い、開発用の .wrangler/state を触らない
paths:
  - "e2e/**"
  - "playwright.config.ts"
---

# E2E の規則

## 専用の D1 を使う

E2E のローカル D1 は **`.wrangler-e2e/state`** に置く（`v3/d1/...` はその下に掘られる）。
開発用の **`.wrangler/state` には読み書きしない**。

- `playwright.config.ts` が `webServer.env` で `RADAR_PERSIST_TO=.wrangler-e2e/state` を渡す
- `vite.config.ts` はその環境変数を `cloudflare({ persistState: { path } })` に渡す。
  未設定なら既定の `.wrangler/state`（＝開発用）のまま
- wrangler CLI には `--persist-to` で同じ値を渡す（`e2e/fixtures/e2e-db.mjs` が一手に引き受ける）
- 固定データを入れるのは `npm run db:seed:e2e`。これも E2E 用 D1 にしか流れない

`wrangler d1 execute DB --local`（`--persist-to` 無し）を E2E の文脈で書かない。
それは開発用 DB を指す。

## 専用のポートを使い、既存サーバーに相乗りしない

- ポートは **5399**。開発用の 5199 や、他のセッションが立てているポートと重ねない
- `reuseExistingServer` は **false** のまま。`true` にすると、同じポートで動いている
  他人の dev サーバー（＝開発用 D1 を見ているサーバー）を掴み、そこに固定データが流れ込む
- テスト内にポートを直書きしない。オリジンが要るときは `baseURL` フィクスチャから取る

## 固定データを開発用 DB に入れない

`e2e/fixtures/seed.sql` の行（`va_e2e*` / `dlsite:RJ9000000*` / `e2e-run-*` など）が
開発用 DB に 1 件でも入ったら、それは経路の設計が壊れている。消して済ませずに経路を直す。

E2E 用 D1 は毎回 `reset` してから作り直す（`e2e/fixtures/prepare.mjs`）。
後片付け用の `cleanup.sql` は持たない。消す処理を持つと、消す先を間違えたときに実データが飛ぶ。

## なぜか

実データはクロールし直すのに数時間かかる。2026-09-19 まで、E2E は共有の `.wrangler/state` に
固定データを入れ、実行後に `cleanup.sql` で消していた。実行中は開発者の画面にテストデータが
混ざり、消し漏れれば残る。さらに `reuseExistingServer` が有効だったため、開発者が開いている
dev サーバーをそのまま乗っ取っていた。
