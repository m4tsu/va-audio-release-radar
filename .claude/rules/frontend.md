---
description: 画面はルート / ページ / 部品の 3 層に分ける。各層を何で検証するか
paths:
  - "src/app/**"
  - "e2e/**"
---

# 画面の層とテストの規則

## なぜ分けるか

ルートファイルに画面が直書きされていると、画面の振る舞いを確かめる手段が
dev サーバーと D1 を起こす E2E しか無くなる。ページと部品に切り出してあれば jsdom で確かめられ、
E2E は「ブラウザとサーバーが要るもの」だけに絞れる。

`npm run check` の `check:layers` (`scripts/check-app-layers.mjs`) が下の表を検査する。

## どの層に何を置くか

| 層 | 置き場所 | 持つもの | 持たないもの | 検証 |
|---|---|---|---|---|
| ルート | `src/app/routes/**` | `createFileRoute`、`loader`、`head`、`server.handlers`、`notFound` / `redirect`、loader の値をページに渡すだけの `component` | HTML 要素の JSX、`useState` などの状態フック、`useT` / `useLocale`、画面の文言 | E2E (HTTP で応答を見る) |
| ページ | `src/app/pages/**` | 画面 1 枚の見出し・区画・空表示・画面内の状態 (並び替え、タブ、絞り込み) | `@/app/server-fns/**` と `@/app/routes/**` の import | 隣の `*.test.tsx` (必須) |
| 部品 | `src/app/components/**` | 複数ページで使う UI。ブラウザから直接サーバーを呼ぶ取得と送信もここ | `@/app/routes/**` と `@/app/pages/**` の import | 状態か保存を持つ部品は隣の `*.test.tsx` (必須) |
| 文書の外枠 | `src/app/routes/__root.tsx` | `<html>` から `<body>`、`HeadContent`、`Scripts` | ヘッダーとフッターの中身 (`components/app-shell.tsx`) | E2E |

依存は ルート → ページ → 部品 の一方向。逆向きの import は `biome.json` が禁じる。

ページはデータを props で受け取る。ルートは loader の戻り値をそのまま渡すので、
形が食い違えば `tsc` が落ちる。画面とサーバーの契約はページの props に 1 つだけ置く。

ページ名はルート名から読める名前にする (`voice-actors.index.tsx` → `pages/voice-actor-directory.tsx`、
`voice-actors.$slug.tsx` → `pages/voice-actor.tsx`)。ルートのファイル先頭コメントに置き場所を書く。

## テストの書き方

- 共通の道具は `src/app/test/`。データは `fixtures.ts`、言語つきの描画は `render.tsx`、
  フォローの読み込み済み状態は `follow.ts`
- ルーターは `src/app/test-setup.ts` が全テストで `src/app/test/router-stub.tsx` に差し替える。
  テストごとに `vi.mock("@tanstack/react-router")` を書かない
- サーバーを呼ぶ部品は、そのテストで呼び先の server function だけを `vi.mock` する
- 見るのは利用者から見た振る舞い。class 名や DOM の形ではなく、role と読み上げ名で要素を取る

## E2E に書いてよいもの

次の 4 つだけ。どれも jsdom では再現できない。

1. **SSR の応答** — title / meta / canonical / JSON-LD / 状態コード / sitemap / 生 HTML に本文が入ること
2. **ハイドレーション** — React が動き出す前後で入力とクリックの届き方が変わる経路
3. **ブラウザ保存** — IndexedDB のフォローがページをまたいで残ること
4. **cookie を SSR が読む経路** — 表示言語、管理者トークン

これに当たらない振る舞いはページか部品のテストに書く。E2E に足すときは、
上のどれに当たるかをテストファイルの先頭コメントに書く。

E2E を走らせるかは差分から決める (`scripts/needs-e2e.sh`)。
`src/app/pages/` と `src/app/components/` だけの変更では走らせない。
