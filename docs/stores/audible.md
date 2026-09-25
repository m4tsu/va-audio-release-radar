# Audible Japan

読者: `crawler/adapters/audible.ts` を触る前の人。取ってよい URL と、相手のサイトの癖を確かめるときに読む
更新: robots.txt を取り直したら (差分が無くても最終確認日を更新する)。サイトの挙動で新しい落とし穴を見つけたら
削除: Audible を対応ストアから外したら

実装: `crawler/adapters/audible.ts`。共通の原則は [`README.md`](./README.md)。

> **ナレーター検索 (`/search`) では並び順 (`sort=`) を使わない。robots.txt が禁じている。**
> 網羅はページング (`page=`) で行う。新着一覧 (`/newreleases`) は逆で、`sort=` 付きの形が
> 1 本ずつ許可され、`page=` はほぼ使えない。

---

## robots.txt

**最終確認日: 2026-09-21** (`https://www.audible.co.jp/robots.txt`、378 行。
2026-09-19 の 377 行から 1 行増えているが、どの行が増えたかは見ていない。
下に引く行と `/newreleases` の `Allow` 52 行は、字面を突き合わせて変化なしを確かめた)

グループは `User-agent: *` の 1 つだけ。**`Crawl-delay` の指定は無い。**
`/search` に関係する行をそのまま引く。

```
#Block search keywords/title pagination excess
Disallow: /search*title=*page=
Disallow: /search*keywords=*page=

#Block non-canonical node + searchAuthor/Narrator pagination
Disallow: /search*node=*searchAuthor=*page=
Disallow: /search*node=*searchNarrator=*page=
Disallow: /search*cache*node=*searchAuthor=*page=
Disallow: /search*cache*node=*searchNarrator=*page=

#Block alternative sort order for /search
Disallow: /search*sort=pubdate
Disallow: /search*sort=title
Disallow: /search*sort=runtime
Disallow: /search*sort=review-rank

#Block searchAuthor/Narrator + category
Disallow: /search*searchAuthor=*node=
Disallow: /search*searchNarrator=*node=
Disallow: /search*node=*searchAuthor=
Disallow: /search*node=*searchNarrator=

#Block more than two filters searchAuthor/Narrator/Provider/Keywords
Disallow: /search*searchAuthor=*=*=*=
Disallow: /search*searchNarrator=*=*=*=
Disallow: /search*searchProvider=*=*=*=

#Block sort pagination
Disallow: /*&sort*&page=

#Block searchAuthor/Narrator/Provider &sort=
Disallow: /search?searchAuthor=*&sort=
Disallow: /search?searchNarrator=*&sort=
Disallow: /search?searchProvider=*&sort=

#Block no result page
Disallow: /no-search-results

#Temp block excess advsearchKeywords
Disallow: /search?advsearchKeywords=*page=
```

ここから導けること:

- **`sort=` は `searchNarrator=` と組み合わせられない。**
  `Disallow: /search?searchNarrator=*&sort=` は `sort` の**値を問わず**禁じている。
  さらに `sort=pubdate` / `sort=title` / `sort=runtime` / `sort=review-rank` は単独でも禁止
- **`page=` は禁止されていない。** `page=` を含む `Disallow` はすべて**別のパラメータを必須に
  している**: `title=` / `keywords=` / `node=` / `advsearchKeywords=` / `sort=`。
  `searchNarrator` + `page` だけの形に一致する行は無い。ナレーター検索の 2 ページ目以降はこれを根拠に引く
- `searchNarrator` と `node=` の併用は禁止
- `/search*searchNarrator=*=*=*=` は `searchNarrator=` の後ろに `=` が 3 つ要る。
  `?searchNarrator={名前}&page=2` は `searchNarrator=` の後ろの `=` が 1 つなので一致しない
- **`/no-search-results` は禁止。** 302 の行き先がここになるが、**追いかけて取得してはいけない**

### `/newreleases` と `/coming-soon`

どちらも一度 `Disallow` したうえで、許可する形を列挙する書き方になっている。関係する行の形:

```
Disallow: /newreleases
Allow: /newreleases$
Allow: /newreleases?submitted=1$
Allow: /newreleases?feature_six_browse-bin=8199814051&feature_twelve_browse-bin=8199774051&sort={並び順}&submitted=1$
Allow: /newreleases?feature_six_browse-bin=8199814051&feature_twelve_browse-bin=8199774051&submitted=1&page=0$
Allow: /newreleases?feature_six_browse-bin=8199814051&feature_twelve_browse-bin=8199774051&submitted=1&page=2$

Disallow: /coming-soon
Allow: /coming-soon$
Allow: /coming-soon?page=
```

- `/newreleases` の `Allow` は全部で **52 行** (2026-09-21) あり、**すべて `$` 終端**。
  パラメータの順序も末尾も 1 文字違えば `Disallow` 側に落ちる
- ページ送りは **`page=0` と `page=2` だけ**が列挙されている。`page=1` も `page=3` 以降も無い。
  `sort=` と `page=` の併用も `Disallow: /*&sort*&page=` で禁止
- `{並び順}` の 9 種類は `/newreleases` の列挙にあるから許可されるのであって、
  `/search` では依然として禁止である。混同しない
- `/coming-soon` は `$` が無いので `page=` が無制限に許可されている。`/newreleases` より緩い。
  配信予定の一覧で、使うかは未決 (「未確認の項目」)

---

## レート間隔

robots.txt に `Crawl-delay` の指定が無いので、**こちらの判断**である。
根拠は、連続アクセスで 302 に飛ばされた実績があること。相手が示していない以上、
短くする根拠もこちらには無い。

---

## 使ってはいけない URL

| 形 | 理由 |
|---|---|
| `/search?searchNarrator=…&sort=…` | `Disallow: /search?searchNarrator=*&sort=` が値を問わず禁止 |
| `/search?…sort=pubdate…` `sort=title` `sort=runtime` `sort=review-rank` | 単独でも禁止 |
| `/search?…&sort=…&page=…` | `Disallow: /*&sort*&page=` |
| `/search?searchNarrator=…&node=…` | `Disallow: /search*searchNarrator=*node=` |
| `/search?title=…&page=…` / `keywords=…&page=…` / `advsearchKeywords=…&page=…` | それぞれ専用の `Disallow` |
| `/no-search-results…` | `Disallow: /no-search-results`。302 の行き先だが追わない |
| `/newreleases` の列挙に無い形 (パラメータの並べ替えや `page=1` を含む) | `$` 終端の `Allow` から外れ、`Disallow: /newreleases` に落ちる |
| パラメータの順序を入れ替えて `sort=` の一致を外した URL | 字面は外れるが、`#Block alternative sort order for /search` と意図が書かれている以上、回避であって遵守ではない |

**`sort` を単独で付ければ HTTP 200 が返る。それは事実だが、根拠にならない。**
応答は「技術的に取れるか」しか答えない。「取ってよいか」に答えるのは robots.txt の条文だけである。

ページングは並び順を使わずに網羅率を上げられる (斉藤壮馬 164 件を 9 ページで 164/164、2026-09-19)。

---

## 既知の落とし穴

- **`searchNarrator=` は完全一致ではない。姓だけでも一致する。**
  「佐藤 元」で引くと総件数 355 件が返るが、1 ページ目 20 件に佐藤元は 1 件も含まれない
  (2026-09-19 実測)。この 355 は「佐藤姓のナレーター作品の総数」であって、その声優の作品数ではない。
  一致率で総件数を捨てる判定は `crawler/adapters/audible.ts` の `LOOSE_MATCH_RATIO`
- **`searchNarrator=` は空白の有無で結果が変わる。**
  「石見舞菜香」は該当なし、「石見 舞菜香」だと 2 件 (2026-09-18 実測)。
  だから検証済みの空白入り別名を先に試す (`crawler/lib/spaced-name.ts`)
- **総件数サマリの表記が 2 通りある。** ちょうど 1 件のときだけ `のうち` が出ない。
  形は `crawler/adapters/audible.ts` の `TOTAL_COUNT_PATTERNS`
- **`/no-search-results` への 302 は「該当なし」の意味で、頻度制限ではない** (2026-09-18 実測)。
  頻度制限と取り違えても既存の listing / credit は消さないので被害は出ない
- **スクレイパー判定で 302 に飛ばされる。** ブラウザ相当の UA を送る (`crawler/lib/fetch.ts` の `userAgentFor()`)
- **一覧の 1 件の中に flyout があり、同じ情報が「、その他」で省略された形で重複している。**
  本文側のラベルだけを読む
- **ポッドキャストが混ざる。** 配信日も再生時間も無い。除外せず配信日なしで保存する
- **検索と新着一覧で `page` の数え方が違って見える。** `/newreleases` の robots に
  `page=0` と `page=2` の `Allow` があり `page=1` が無いため 0 始まりに見えたが、
  検索側は 1 始まりだった (2026-09-19 実測)。ページ番号のような挙動は推測せず実データで確かめる
- **緩い一致で連れてきた同姓の別人の作品は、多くが無駄にならない。** 佐藤元の検索が連れてきた
  佐藤恵の作品は、佐藤恵自身が追跡対象なので使われる
- **AI 読み上げの作品はナレーター名を取れない。** 一覧に「Virtual Voice」「デジタルボイス」と出るが、
  人名と違ってリンクにならない。人のナレーターが居ないので、月次の声優検索でもこの作品は出てこない
  (実例は `crawler/fixtures/audible-newreleases-pubdate-desc.html`、
  件数は [`audible-daily-feed-2026-09-21.md`](../research/audible-daily-feed-2026-09-21.md))
- `/coming-soon` は 4 割近くの作品でナレーター名が取れない
  ([`new-release-feeds-2026-09-19.md`](../research/new-release-feeds-2026-09-19.md))
- **年齢区分を公開していない。** 全年齢とは言い切れない
- **アフィリエイトは作品単位のリンクを作れない** (2026-09-24、バリューコマースの管理画面の表示)。
  報酬になるのは Audible の会員の新規登録だけ (1 件 1,650 円、税込) で、リンク先は広告主が固定している。
  広告コードの改変の制約は [`pokedora.md`](./pokedora.md) の「アフィリエイト (バリューコマース MyLink)」と同じ

---

## 未確認の項目

- **ページングで実際に何件まで取れるか、500 人規模での実測。**
  斉藤壮馬 1 人で 164/164 を確認しただけである (2026-09-19)
- `MAX_PAGES` の上限に当たる声優が実在するか
- `/newreleases` の新着枠を、許可された形だけで覆い切れるか。
  2026-09-19 に 9 リクエストで 105 件中 80 件までは確認済み。残りは node 別 14 本などで届く見込み **(推測)**
- `/newreleases` の反映遅れ。2026-09-19 時点で窓の最新が 2026-09-18 だった **(推測: 1 日程度)**
- `/coming-soon` を使うか。総ページ数 (総件数の表示が無く、辿らないと分からない)
- 年齢区分。ストアが公開していないので、こちらからは確認しようがない
- 一覧 HTML に価格と役名が載るか。取得していない

---

## 出典

- [`docs/research/new-release-feeds-2026-09-19.md`](../research/new-release-feeds-2026-09-19.md) —
  robots の再確認、`sort=` 違反の発見、`/newreleases` と `/coming-soon` の許可される形、実測
- [`docs/research/audible-daily-feed-2026-09-21.md`](../research/audible-daily-feed-2026-09-21.md) —
  日次の走行 1 回目の件数と、ナレーター名を取れない作品が AI 読み上げであること
- `crawler/adapters/audible.ts` のファイル冒頭コメント — robots の引用と、`page` が 1 始まりであることの実測
