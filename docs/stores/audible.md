# Audible Japan

読者: `crawler/adapters/audible.ts` を触る前の人
更新: robots.txt を取り直したら (差分が無くても最終確認日を更新する)。使う URL の形やセレクタを変えたら
削除: Audible を対応ストアから外したら

実装: `crawler/adapters/audible.ts`
共通の原則は [`README.md`](./README.md)。

> **並び順 (`sort=`) は使わない。robots.txt が禁じている。** 網羅はページング (`&page=N`) で行う。

---

## 1. robots.txt

**最終確認日: 2026-09-21** (`https://www.audible.co.jp/robots.txt`、378 行。
`/newreleases` の `Allow` は 52 行で、2026-09-19 の記述から変化なし)

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
  `searchNarrator` + `page` だけの形に一致する行は無い
- `searchNarrator` と `node=` の併用は禁止
- `/search*searchNarrator=*=*=*=` は `searchNarrator=` の後ろに `=` が 3 つ要る。
  `?searchNarrator={名前}&page=2` は `=` が 1 つなので一致しない
- **`/no-search-results` は禁止。** 302 の行き先がここになるが、**追いかけて取得してはいけない**

`/newreleases` と `/coming-soon` にも規則があり、こちらは `Disallow` のあとに許可する形を
1 本ずつ列挙する書き方になっている (§3 の「まだ使っていない形」)。

---

## 2. レート間隔

> **実装の値は `crawler/lib/fetch.ts` の `rateLimitFor()` が持つ。食い違ったらコードが正。**
> この節は、なぜその値なのかを書く場所であって、値を複製する場所ではない。

キーは `audible`。

robots.txt に `Crawl-delay` の指定が無いので、**こちらの判断**である。
根拠は、連続アクセスで 302 に飛ばされた実績があること。相手が示していない以上、
短くする根拠もこちらには無い。

---

## 3. 使う URL

### ナレーター検索 (1 ページ目)

```
https://www.audible.co.jp/search?searchNarrator={名前}
```

### 2 ページ目以降

```
https://www.audible.co.jp/search?searchNarrator={名前}&page={N}
```

- 許可の根拠: §1 のとおり `page=` を禁じる行はすべて別パラメータを必須にしており、
  この形に一致する `Disallow` が無い
- **`page=N` は `20 × (N − 1) + 1` 件目から。1 始まりである** (2026-09-19 実測)。
  `page` 省略時は `page=1` と同じで、ASIN まで完全に一致する。
  1 ページ目は `page` を付けない形で引く (パラメータが少ないほうが正規形に近い)
- 1 ページ 20 件。引くのをやめる条件は 4 つ:
  和集合が総件数に達した / 直前のページが 20 件に満たなかった (そこが最終ページ) /
  **10 ページ (200 件) に達した** (`MAX_PAGES`) / 取得に失敗した。
  2 つ目は総件数が読めなくても効く。上限に当たった声優は警告に残して管理画面で拾う
- `Accept-Language: ja-JP` を送る
- 検証済みの空白入り別名があればそれを先に試し、無ければ `canonicalName` で引く (§6)

### 正規の商品 URL (保存する `productUrl`)

```
https://www.audible.co.jp/pd/{ASIN}
```

一覧の href は `/pd/{slug}/{ASIN}` の形で、slug 部分はタイトル変更で変わりうるので使わない。

### 新着一覧 (日次の走行が使う)

**引く URL の一覧は `crawler/adapters/audible.ts` の `AUDIBLE_FEED_URLS` が持つ。**
この節はなぜその形なのかを書く場所であって、URL を複製する場所ではない。

robots.txt は `/newreleases` を一度 `Disallow` したうえで、許可する形を 1 本ずつ
`$` 終端で列挙している。関係する行の形:

```
Disallow: /newreleases
Allow: /newreleases$
Allow: /newreleases?submitted=1$
Allow: /newreleases?feature_six_browse-bin=8199814051&feature_twelve_browse-bin=8199774051&sort={並び順}&submitted=1$
Allow: /newreleases?feature_six_browse-bin=8199814051&feature_twelve_browse-bin=8199774051&submitted=1&page=0$
Allow: /newreleases?feature_six_browse-bin=8199814051&feature_twelve_browse-bin=8199774051&submitted=1&page=2$
```

- `/newreleases` の `Allow` は全部で **52 行**あり、**すべて `$` 終端**。
  パラメータの順序も末尾も 1 文字違えば `Disallow` 側に落ちる。
  **文字列を定数でそのまま持ち、URL を組み立て直さない**
- ページ送りは **`page=0` と `page=2` だけ**が列挙されている。`page=1` も `page=3` 以降も無い。
  `sort=` と `page=` の併用も `Disallow: /*&sort*&page=` で禁止
- そのため網羅は**並び順違いの 1 ページ目の和集合**で稼ぐ。どの並びがどれだけ取り分を
  増やしたかは [`new-release-feeds-2026-09-19.md`](../research/new-release-feeds-2026-09-19.md)
- ここでの `{並び順}` 9 種類は `/newreleases` の列挙にあるから許可されるのであって、
  `/search` では依然として禁止である。混同しない
- **一覧にナレーターと配信日が載るので、作品ページは引かない。**
  ナレーター欄が空の作品は誰の作品か決められないので送らず、月次の声優起点で拾う

### まだ使っていないが、許可が確認できている形

配信予定 (`docs/research/upcoming-releases-2026-09-18.md` の入力)。**採否は未決。**

```
Disallow: /coming-soon
Allow: /coming-soon$
Allow: /coming-soon?page=
```

- `/coming-soon` は `$` が無いので `page=` が無制限に許可されている。`/newreleases` より緩い

---

## 4. 使ってはいけない URL

| 形 | 理由 |
|---|---|
| `/search?searchNarrator=…&sort=…` | `Disallow: /search?searchNarrator=*&sort=` が値を問わず禁止 |
| `/search?…sort=pubdate…` `sort=title` `sort=runtime` `sort=review-rank` | 単独でも禁止 |
| `/search?…&sort=…&page=…` | `Disallow: /*&sort*&page=` |
| `/search?searchNarrator=…&node=…` | `Disallow: /search*searchNarrator=*node=` |
| `/search?title=…&page=…` / `keywords=…&page=…` / `advsearchKeywords=…&page=…` | それぞれ専用の `Disallow` |
| `/no-search-results…` | `Disallow: /no-search-results`。302 の行き先だが追わない |
| パラメータの順序を入れ替えて `sort=` の一致を外した URL | 字面は外れるが、`#Block alternative sort order for /search` と意図が書かれている以上、回避であって遵守ではない |


**`sort` を単独で付ければ HTTP 200 が返る。それは事実だが、根拠にならない。**
応答は「技術的に取れるか」しか答えない。「取ってよいか」に答えるのは robots.txt の条文だけである。

ページングは並び順を使わずに網羅率を上げられる (斉藤壮馬 164 件を 9 ページで 164/164、2026-09-19)。

---

## 5. 取得できる項目 / できない項目

一覧 HTML はサーバー側で描画済み。`li.productListItem[id="product-list-item-{ASIN}"]` が 1 件。

| 項目 | 可否 | セレクタ / 備考 |
|---|:--:|---|
| ASIN | ○ | `li.productListItem` の `id` |
| タイトル | ○ | `h3 a` / `a[href^="/pd/"]` |
| ナレーター名 | ○ (全員) | `li.narratorLabel a`。**本文側の `li` にだけこの class が付く** |
| 著者名 | ○ | `li.authorLabel a` |
| 配信日 | △ | `li.releaseDateLabel`。ポッドキャストには無い |
| 再生時間 | △ | `li.runtimeLabel`。ポッドキャストには無い |
| 表紙 | ○ | `img.bc-image-inset-border[src]` |
| 総件数 | △ | 検索結果サマリ。表記が 2 通りある (§6) |
| 価格 | × | 取得していない |
| **年齢区分** | **×** | 公開されていない。`ageRating` は `unknown` 固定 |
| ストア固有の分類 | — | `storeCategory` は `audiobook` 固定 (朗読以外の判定をしない) |
| 役名 | × | 持っていない |

---

## 6. 既知の落とし穴

- **`searchNarrator=` は完全一致ではない。姓だけでも一致する。**
  「佐藤 元」で引くと総件数 355 件が返るが、1 ページ目 20 件のナレーターは
  佐藤恵・佐藤詩乃・佐藤弘樹・佐藤佑暉・佐藤慧・佐藤正宏で、**佐藤元は 1 件も含まれない**
  (2026-09-19 実測)。この 355 は「佐藤姓のナレーター作品の総数」であって、その声優の作品数ではない
  - 対策: 取得した作品のうち本人がクレジットされている件数を数え、**一致率が 0.2 未満なら
    総件数と網羅率を「不明」に落とす** (`complete: false` にはしない。取り逃しているのは
    本人の作品ではなく同姓の別人の作品だから)
  - しきい値 0.2 の根拠: 0 に近い側と 1 に近い側がはっきり分かれる (佐藤元 0/20、斉藤壮馬 82/83)
  - 照合は `creditedNames` だけで行い、タイトルは見ない。「斉藤壮馬の本心」のように
    本人名がタイトルに入る番組があるため
- **`searchNarrator=` 自体も空白の有無で結果が変わる。**
  「石見舞菜香」は該当なし、「石見 舞菜香」だと 2 件。
  だから声優ごとに空白入りの別名候補を持たせている (`crawler/discovery/actor-entity.ts`)
- **総件数サマリの表記が 2 通りある。**
  2 件以上は「検索結果 164 のうち 1 - 20 件」、ちょうど 1 件は「検索結果 1 件」で `のうち` が出ない。
  `のうち` だけを見ていたため、500 人のクロールで総件数を読めなかった 73 件は**すべて取得 1 件**だった
  - それでも読めないときは「1 ページ目が 20 件に満たなければページングが起きていない」とみなす。
    ちょうど 20 件で総件数も読めないときだけ「不明」にする。
    この判定は**検証落ちを引く前の件数**で行う (捨てた分を引くと「20 件未満だから全件」と誤る)
- **`/no-search-results?keywords=null` への 302 は「該当なし」の意味で、頻度制限ではない。**
  adapter は `status: "empty"` (成功・0 件) として返す。既存の listing / credit は消さないので、
  取り違えても被害は出ない。前回 > 0 から 0 への急減は管理画面の警告で拾う
- **`li.productListItem` の中に flyout (popover) があり、同じ情報が短縮形で重複している。**
  flyout 側は「、その他」で省略されるので、**必ず本文側のラベル class を使う**
- **ポッドキャストが混ざる。** 配信日も再生時間も無い。除外せず `releaseDate` なしで保存する
- **ページ間で ASIN は重複しない** (斉藤壮馬の 9 ページ 164 件で重複 0 を実測)。
  重複が出たら取得中に並びが動いた合図なので、黙って畳まず警告に積む
- **ページ番号のような挙動は推測せず実データで確かめる。** `/newreleases` の robots に
  `&page=0` と `&page=2` の `Allow` があり `page=1` が無いため 0 始まりに見えたが、
  検索側は 1 始まりだった
- **緩い一致による保存量の増加は小さい。** 作品 1,764 件のうち追跡対象の声優が 1 人も
  クレジットされていないものは 87 件 (4.9%)。多くは童話シリーズなど対象外のナレーターの作品で、
  23 件はナレーター欄自体が無い。佐藤元の検索が連れてきた佐藤恵の作品 10 件は、
  **佐藤恵自身が追跡対象**なので無駄になっていない
- ブラウザ相当の UA を送る。スクレイパー判定で 302 に飛ばされるのを避けるため
- (新着一覧を使う場合) **`/newreleases` の一覧は 80 件中 14 件 (18%) がナレーター欄が空**、
  `/coming-soon` は 39 件中 15 件 (38%) が空

---

## 7. 未確認の項目

- **ページングで実際に何件まで取れるか、500 人規模での実測。**
  斉藤壮馬 1 人で 164/164 を確認しただけである
- `MAX_PAGES = 10` (200 件) に当たる声優が実在するか
- `/newreleases` の新着枠 105 件を、許可された形だけで覆い切れるか。
  9 リクエストで 80/105 (76%) までは確認済み。残りは node 別 14 本などで届く見込み **(推測)**
- `/newreleases` の反映遅れ。2026-09-19 時点で窓の最新が 2026-09-18 だった **(推測: 1 日程度)**
- `/coming-soon` の総ページ数 (総件数の表示が無く、辿らないと分からない)
- 年齢区分。ストアが公開していないので、こちらからは確認しようがない

---

## 8. 出典

- [`docs/research/new-release-feeds-2026-09-19.md`](../research/new-release-feeds-2026-09-19.md) —
  robots の再確認、`sort=` 違反の発見、`/newreleases` と `/coming-soon` の許可される形、実測
- `crawler/adapters/audible.ts` のファイル冒頭コメント — robots の引用と、`page` が 1 始まりであることの実測
