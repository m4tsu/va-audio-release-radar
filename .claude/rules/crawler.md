---
description: クローラーを触る前に docs/stores/<store>.md を読み、robots.txt の該当行を確認する
paths:
  - "crawler/**"
---

# クローラーの規則

## 触る前に `docs/stores/` を読む

`crawler/adapters/` や `crawler/discovery/` を変更する前に、**対応するストアのファイルを読む**。

| 触るもの | 先に読むもの |
|---|---|
| `crawler/adapters/dlsite.ts`、`discovery/dlsite-sitemap.ts` | [`docs/stores/dlsite.md`](../../docs/stores/dlsite.md) |
| `crawler/adapters/audible.ts` | [`docs/stores/audible.md`](../../docs/stores/audible.md) |
| `crawler/adapters/pokedora.ts`、`discovery/pokedora-*.ts` | [`docs/stores/pokedora.md`](../../docs/stores/pokedora.md) |
| `crawler/discovery/anilist.ts`、`build-actors.ts` | [`docs/stores/anilist.md`](../../docs/stores/anilist.md) |
| `crawler/lib/fetch.ts` | [`docs/stores/README.md`](../../docs/stores/README.md) |

## 取得する URL の形を変えるなら、robots.txt を確認して引用を残す

URL・パラメータ・ページングを変えるときは、次の順で行う。

1. **その時点の robots.txt を取り直す**
2. 該当する `Disallow` / `Allow` の行を探し、**一致するかを字面で判定する**
3. その行を `docs/stores/<store>.md` の「robots.txt」節に**そのまま貼り**、最終確認日を更新する
4. コードを変える

**確認せずに変えない。** 記憶や以前の読みを根拠にしない。
パラメータの順序を入れ替えて字面の一致だけ外すのは、回避であって遵守ではない。

## レート間隔を勝手に変えない

間隔は `crawler/lib/fetch.ts` の `rateLimitFor()` が持つ。**この規則にも数字を書かない。**
値を知りたいならコードを読む。なぜその値かは `docs/stores/<store>.md` の §2 にある。

短くしてよいのは、相手が示した根拠 (robots の `Crawl-delay`、公開された API 枠) が
あるときだけ。「API だから軽い」はこちらの都合であって根拠にならない。

変えるときは、次の 2 つを**必ず同時に**行う。

1. `docs/stores/<store>.md` §2 に、新しい値の根拠を書く
2. `crawler/lib/fetch.ts` の `rateLimitFor()` を変え、§2 の記述と揃っていることを確かめる

出典を `rateLimitFor()` 1 つに絞っている理由は [`../../CLAUDE.md`](../../CLAUDE.md) の
「同じ事実を 2 か所に書かない」にある。

## 過去 4 回、この確認を怠って誤った実装を入れた

- **DLsite `per_page`**: 「指定すると 0 件」と設計書に書いたが、実際は無視されるだけだった
- **DLsite `Crawl-delay`**: robots が全パスに `Crawl-delay` を指定しているのに `product.json` を
  「軽い API だから」と短い間隔で叩いた
- **Audible `page=`**: 「robots が禁じている」と読み違え、使える手段を自分で潰していた
- **Audible `sort=`**: robots が明確に禁じているのに並び順 6 種類を実装した (同日中に取り下げ)

## 実サイトへのアクセスは最小限にする

- **ネットワークに出るテストは書かない。** パーサーのテストは `crawler/fixtures/` の
  固定 HTML / JSON に対して書く。フィクスチャで足りるならフィクスチャを使う
- 新しいフィクスチャが要るときだけ実サイトを引き、取ったものを切り詰めて `fixtures/` に置く
- 外部への `fetch` は `crawler/lib/fetch.ts` の 1 箇所を必ず通す。adapter から素の `fetch` を呼ばない

## 同じホストを 2 つのプロセスから叩かない

**レートリミッタはプロセス単位**である (`fetch.ts` の `nextAllowedAt` は Node プロセス内の Map)。
2 つ動けば実効間隔は半分になる。始める前に、他のセッションやエージェントが
同じホストをクロールしていないか確認する。

```
npx wrangler d1 execute DB --local --command \
  "select started_at, finished_at, store_slug from crawl_runs order by started_at desc limit 5"
```

最新行の `finished_at` が NULL で `started_at` が直近なら、動いている可能性が高い。
その場合は終わるまで待つか、別のホストの作業に切り替える。
