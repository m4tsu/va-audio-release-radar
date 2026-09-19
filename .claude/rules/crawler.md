---
description: クローラーを触る前に docs/stores/<store>.md を読み、robots.txt の該当行を確認する
paths:
  - "crawler/**"
---

# クローラーの規則

## 触る前に `docs/stores/` を読む

| 触るもの | 先に読むもの |
|---|---|
| `crawler/adapters/dlsite.ts`、`discovery/dlsite-sitemap.ts` | [`docs/stores/dlsite.md`](../../docs/stores/dlsite.md) |
| `crawler/adapters/audible.ts` | [`docs/stores/audible.md`](../../docs/stores/audible.md) |
| `crawler/adapters/pokedora.ts`、`discovery/pokedora-*.ts` | [`docs/stores/pokedora.md`](../../docs/stores/pokedora.md) |
| `crawler/discovery/anilist.ts`、`build-actors.ts` | [`docs/stores/anilist.md`](../../docs/stores/anilist.md) |
| `crawler/lib/fetch.ts` | [`docs/stores/README.md`](../../docs/stores/README.md) |

## 取得する URL の形を変えるなら、robots.txt を確認して引用を残す

URL・パラメータ・ページングを変えるときは、次の順で行う。

1. その時点の robots.txt を取り直す
2. 該当する `Disallow` / `Allow` の行を探し、一致するかを字面で判定する
3. その行を `docs/stores/<store>.md` の「robots.txt」節にそのまま貼り、最終確認日を更新する
4. コードを変える

記憶や以前の読みを根拠にしない。パラメータの順序を入れ替えて字面の一致だけ外すのは、回避であって遵守ではない。
サーバーが 200 を返すことは「取ってよい」の根拠にならない。

## レート間隔を勝手に変えない

間隔は `crawler/lib/fetch.ts` の `rateLimitFor()` が持つ。この規則にも数字を書かない。
短くしてよいのは、相手が示した根拠 (robots の `Crawl-delay`、公開された API 枠) があるときだけ。
「API だから軽い」はこちらの都合であって根拠にならない。

変えるときは `docs/stores/<store>.md` の「レート間隔」に新しい値の根拠を書き、`rateLimitFor()` を変える。同時に行う。

## 実サイトへのアクセスは最小限にする

- ネットワークに出るテストは書かない。パーサーのテストは `crawler/fixtures/` の固定 HTML / JSON に対して書く
- 新しいフィクスチャが要るときだけ実サイトを引き、取ったものを切り詰めて `fixtures/` に置く
- 外部への `fetch` は `crawler/lib/fetch.ts` の 1 箇所を必ず通す。adapter から素の `fetch` を呼ばない

## 同じホストを 2 つのプロセスから叩かない

レートリミッタは Node プロセス内の状態 (`fetch.ts` の `nextAllowedAt`)。2 つ動けば実効間隔は半分になる。
始める前に、他のセッションが同じホストをクロールしていないかを確かめる (確認方法は `CLAUDE.md` の「ローカルの共有資源」)。
