# Wikimedia (日本語版 Wikipedia / Wikidata)

読者: 声優のかな (読み仮名) の入手元を触る前の人。Wikimedia のサイトへアクセスする前の人
更新: robots.txt・利用規約・User-Agent ポリシーを取り直したら (差分が無くても最終確認日を更新する)
削除: Wikimedia を声優のかなの入手元から外したら

実装: かなの取得は `crawler/discovery/wikipedia-kana.ts`、記事 HTML の解析は
`crawler/discovery/wikipedia-article.ts`。外部アクセスは `crawler/lib/fetch.ts` を通り、
GET で記事 HTML を取るだけで、間隔は既定値のまま。ブラウザ相当の UA を Wikimedia が
禁じている (「既知の落とし穴」) ので、UA の振り分けは `fetch.ts` の `userAgentFor()` が持つ。
共通の原則は [`README.md`](./README.md)。

**ストアではない。** 声優のかなの入手元の候補であり、ここから作品は取らない。
どれだけのかなが取れるかの測定は
[`docs/research/actor-kana-sources-2026-09-20.md`](../research/actor-kana-sources-2026-09-20.md)、
採否は [`docs/decisions/0006-actor-kana-from-wikipedia-ja.md`](../decisions/0006-actor-kana-from-wikipedia-ja.md)。

---

## 1. robots.txt

**最終確認日: 2026-09-20。**

`ja.wikipedia.org` と `www.wikidata.org` の robots.txt は、**共通部分 (`User-agent: *` グループ) が
`Sitemap:` の 1 行を除いて完全に一致する** (両方を取得し、ローカル追記の区切り行より前を行単位で比較した)。
その共通部分の先頭:

```
User-agent: *
Allow: /w/api.php?action=mobileview&
Allow: /w/load.php?
Allow: /api/rest_v1/?doc
Allow: /w/rest.php/site/v1/sitemap
Disallow: /w/
Disallow: /api/
Disallow: /trap/
Disallow: /wiki/Special:
```

引用は先頭だけで全文ではない。省いたのは `/wiki/` で始まる 303 行で、**すべて特定のページ名か
名前空間 (`Wikipedia:削除依頼/` `WP:` `Category:緊急案件` など) を名指ししている**。
`ja.wikipedia.org` の `User-agent: *` グループの `Disallow` は全部で 306 行あり、
上に引いた `/w/` `/api/` `/trap/` の 3 行と、この 303 行がその内訳になる。
**記事名前空間そのものを禁じる行 (`Disallow: /wiki/` 単独) は無く、`Crawl-delay` もこのグループには無い。**

字面で読むと次のようになる。

- `/wiki/<記事名>` は禁止されていない。**記事 HTML は取ってよい** (声優の記事名を名指しする
  `Disallow` は上記 303 行に無い)
- `Disallow: /w/` に `/w/api.php` が含まれる。`Allow` されているのは `action=mobileview` と
  `load.php` と sitemap だけなので、**Action API (`/w/api.php?action=query...`) は使えない**
- `Disallow: /api/` に REST API が含まれる。`Allow: /api/rest_v1/?doc` は API 文書のページだけ。
  **REST API のデータ取得は使えない**
- `Disallow: /wiki/Special:` に `Special:EntityData` と `Special:Search` が含まれる。
  **Wikidata の項目 JSON (`/wiki/Special:EntityData/Q….json`) と名前検索は使えない**

`query.wikidata.org` は**別の robots.txt を返す**。全文:

```
# robots.txt for http://query.wikidata.org/
User-agent: *
Disallow: /sparql
Disallow: /bigdata
```

**SPARQL エンドポイントは使えない。** 名前の一覧から一括で照会する手段はここだけだったので、
この 1 行が入手方法の形を決めている (「使ってはいけない URL」を参照)。

`dumps.wikimedia.org` は robots.txt を持たない (HTTP 404、2026-09-20 確認)。

---

## 2. レート間隔

> **実装の値は `crawler/lib/fetch.ts` の `rateLimitFor()` が持つ。食い違ったらコードが正。**
> この節は、なぜその値なのかを書く場所であって、値を複製する場所ではない。

ホスト名がそのままキーになる既定値 (`rateLimitFor()` の最後の `return`) をそのまま使う。根拠は 3 つ。

1. `User-agent: *` グループに `Crawl-delay` の指定が無い。ファイル中で唯一の `Crawl-delay` は
   SemrushBot 向けで、そこに**運営者自身が妥当と考える間隔の説明が付いている**。原文引用:

   > \# Per their statement, semrushbot respects crawl-delay directives
   > \# We want them to overall stay within reasonable request rates to
   > \# the backend (20 rps); keeping in mind that the crawl-delay will
   > \# be applied by site and not globally by the bot, 5 seconds seem
   > \# like a reasonable approximation

2. 運営者の Robot policy (`wikitech.wikimedia.org/wiki/Robot_policy`、2026-09-20 確認) が
   website への上限を数値で示している。原文引用:

   > Assuming you are following all of our best practices ideally, still ensure that the maximum
   > concurrent number of requests is fewer than 10 overall, and keep the average requests per
   > second below 20.

3. 同じ policy は、上限がドメインごとではなく **Wikimedia の全サイト合計** だと書いている。原文引用:

   > These limits are not per-domain but global for all Wikimedia properties

既定値で直列に 1 本ずつ投げるかぎり、2 の上限を大きく下回る。`ja.wikipedia.org` と
`www.wikidata.org` はキーが別になるので同時に走りうるが、2 本合わせても 3 の合算に届かない。

---

## 3. 使う URL

```
GET https://ja.wikipedia.org/wiki/<記事名>
GET https://www.wikidata.org/wiki/<Q id>
```

**クエリパラメータを付けない。** Robot policy の website rules の原文引用:

> Always crawl the website via the /wiki/Article_name URLs, with no query parameters. This will
> ensure that if the content is CDN-cached, you'll get a faster response allowing you to crawl
> the site faster and more efficiently.

記事 HTML には対応する Wikidata の項目 id が埋め込まれている (`wgWikibaseItemId`)。
**Wikipedia の記事から Wikidata の項目へはこの 1 本で辿れる。** 逆向き (名前から項目) の手段は無い。

一度きりのバッチで全対象声優を引く規模になるなら、live リクエストより dump を先に検討する。
同じ policy の原文引用:

> Consider if dumps are more efficient than live requests. Check if you can use Wikimedia Dumps
> or other forms of offline collection of our data instead of making live requests.

日本語版 Wikipedia の記事 dump は
`https://dumps.wikimedia.org/jawiki/latest/jawiki-latest-pages-articles.xml.bz2` にある。
大きさの実測は
[`docs/research/actor-kana-sources-2026-09-20.md`](../research/actor-kana-sources-2026-09-20.md) の「取得コスト」。

---

## 4. 使ってはいけない URL

robots.txt から直に出るもの。

- `/w/api.php` (Action API)。`action=mobileview` 以外は `Disallow: /w/` に当たる
- `/api/rest_v1/page/...` (REST API のデータ取得)。`Disallow: /api/` に当たる
- `https://query.wikidata.org/sparql` (SPARQL)
- `/wiki/Special:EntityData/Q….json` と `/wiki/Special:Search` (`Disallow: /wiki/Special:`)
- `/wiki/<記事名>?action=raw` などクエリ付きの記事取得 (「使う URL」の引用)

**運営者の文書の中で、robots.txt と Robot policy の読みが噛み合わない点がある。**
Robot policy は「Honor every directive in our robots.txt file」と書きながら、
同じページに Action API と REST API の使い方 (同時数と毎秒リクエスト数) を書いている。
どちらが優先かはこの 2 つを読んでも決まらない。**このプロジェクトは robots.txt の字面に従い、
API を使わない**。`/wiki/<記事名>` だけで必要な項目が取れるので、噛み合わない側に賭ける理由が無い。

パラメータの順序替えや別ホスト経由で字面の一致を外すことはしない ([`README.md`](./README.md) の原則)。

---

## 5. 取得できる項目 / できない項目

| 項目 | 可否 | どこから |
|---|:--:|---|
| かな (日本語版 Wikipedia) | ○ | 記事 HTML に埋め込まれたテンプレート呼び出しの記録 (`data-mw` 属性の JSON) の `ふりがな` 引数。導入部の `<b>名前</b>（かな、` にも出る |
| かな (Wikidata) | △ | 項目 HTML の P1814 (name in kana)。単独の主張ではなく限定子のこともある (「既知の落とし穴」) |
| Wikidata の項目 id | ○ | 記事 HTML の `wgWikibaseItemId` |
| 記事のカテゴリ | ○ | 記事 HTML の `mw:PageProp/Category`。声優かどうか、曖昧さ回避かどうかの判定に使う |
| リダイレクト先の記事名 | ○ | 記事 HTML の `wgPageName` |
| **名前から Wikidata の項目を引く** | **×** | 検索も API も SPARQL も robots.txt で禁止。Wikipedia の記事か dump を経由するしかない |
| **ローマ字** | 範囲外 | Wikidata の P2125 (revised Hepburn) が P1814 の限定子に入っていることがある |

---

## 6. 既知の落とし穴

- **ブラウザの UA を名乗ってはいけない。** 他のストアと要求が逆である。
  User-Agent policy (`foundation.wikimedia.org/wiki/Policy:User-Agent_policy`、2026-09-20 確認) の原文引用:

  > As of February 15, 2010, Wikimedia sites require a HTTP User-Agent header for all requests.

  > Do not copy a browser's user agent for your bot, as bot-like behavior with a browser's user
  > agent will be assumed malicious. Do not use generic agents such as "curl", "lwp",
  > "Python-urllib", and so on.

  > The generic format is `<client name>/<version> (<contact information>) <library/framework name>/<version>`.

  自己申告の UA は `<クライアント名> (<連絡先>)` の形で、連絡先にはこのリポジトリの URL を使える。
  「bot」を含めることも推奨されている (同じページの "please consider following the Internet-wide
  convention of including the string \"bot\" in the User-Agent string")

- **`Accept-Encoding: gzip` を送る。** Robot policy の原文引用:

  > Default to gzip. Always request content with an `Accept-Encoding: gzip` HTTP header to reduce
  > bandwidth usage.

  Node の `fetch` は既定で `Accept-Encoding: gzip, deflate` を付ける

- **利用規約が、上の 2 つの policy を規約の一部として取り込んでいる。**
  Terms of Use (`foundation.wikimedia.org/wiki/Policy:Terms_of_Use`、2026-09-20 確認) の原文引用:

  > By using our APIs, you agree to abide by all applicable policies governing the use of the APIs,
  > which include but are not limited to the User-Agent Policy, the Robot Policy, and the
  > API:Etiquette (collectively, "API Documentation"), which are incorporated into these Terms
  > of Use by reference.

  自動アクセスそのものを禁じる条項は無く、禁止されているのは次の形である (同じページ、原文引用):

  > Engaging in automated uses of the Project Websites that are abusive or disruptive of the
  > services, violate acceptable usage policies where available, or have not been approved by
  > the Wikimedia community;

  > Disrupting the services by placing an undue burden on an API, Project Website or the networks
  > or servers connected with a particular Project Website;

- **記事名に空白が入る名前は `_` に置き換える。** 空白のまま URL に入れると 301 が返り、
  `fetch.ts` はリダイレクトを追わないので取りこぼす
- **リダイレクトで別の記事に着地する。** `/wiki/<声優名>` がユニット記事やグループ記事に転送されることがある。
  着地先の読みを取ると、その声優ではなくグループの読みが入る。`wgPageName` が要求した名前と
  一致することを確かめる
- **曖昧さ回避ページにも読みが書いてある。** 記事が無いのに読みが取れてしまう。
  カテゴリに「曖昧さ回避」を含むページは捨てる
- **同名の別人。** 記事名が一致していても、声優ではない同名の人物の記事のことがある。
  カテゴリに「声優」を含む語 (「日本の女性声優」など) があることを条件にする
- **Wikidata の P1814 は単独の主張とは限らない。** P1559 (name in native language)、
  P1477 (birth name)、P2562 (married name) の限定子として付いていることがある。
  **P2562 は結婚後の姓なので、そこから取ると別の読みになる。** 拾ってよいのは
  単独の P1814 と P1559 の限定子まで
- **名前そのものがかなの声優は、記事に読みが書かれない。** `Template:声優` の `ふりがな` が空で、
  導入部の括弧も無い。この場合は名前をそのままかなとして扱う
- **手で書いた既存のかなは、空白を入れないひらがなで入っている**
  (`crawler/actors-overrides.json` の `nameKana`。D1 の列は `name_kana`)。
  Wikipedia と Wikidata は姓と名の間に空白を入れ、名前がラテン文字の声優にはカタカナの読みを載せる。
  `src/domain/normalize.ts` の `normalizeName` は空白を落とすがかなとカナは変換しないので、
  **カタカナのまま入れるとひらがなで引いた検索に当たらない**
- **ライセンスが 2 つのサイトで違う。** Wikidata (`Wikidata:Licensing`、2026-09-20 確認) の原文引用:

  > All structured data in the main, property and lexeme namespaces is made available under the
  > Creative Commons CC0 License (Public domain); text in other namespaces is made available
  > under the Creative Commons Attribution-ShareAlike 4.0 License.

  日本語版 Wikipedia (`Wikipedia:ウィキペディアを二次利用する`、2026-09-20 確認) の原文引用:

  > ウィキペディアの文章素材は、クリエイティブ・コモンズ 表示・継承ライセンス（以下、「CC BY-SA」という。）の
  > 条件の下で二次利用することができます。

  > 文章素材を頒布するときは、その形態がいかなるものであっても、著作者への著作権表示 (credit) を
  > 提供しなければなりません。

  Terms of Use は事実の再利用について次のようにも書いている (2026-09-20 確認、原文引用):

  > Where you own Sui Generis Database Rights covered by CC BY-SA 4.0, you waive these rights.
  > As an example, this means facts you contribute to the projects may be reused freely without
  > attribution.

  **Wikidata の P1814 は CC0 なので表示義務が無い。Wikipedia の記事から取った文字列には
  CC BY-SA の条件が付く。** このプロジェクトは「人名の読み 1 つ」を上の引用の言う "facts" として扱い、
  かなを出す画面に出典とライセンスを添えない (`docs/product.md` の「外部サービスとの関係」、
  [`docs/decisions/0006-actor-kana-from-wikipedia-ja.md`](../decisions/0006-actor-kana-from-wikipedia-ja.md))

---

## 7. 未確認の項目

- **dump からの抽出**。live リクエストの代わりに dump を使う経路は試していない。
  展開して `Template:声優` を拾うコストも測っていない
- **記事名が対象声優の名前と違う場合の拾い漏れ**。`名前 (声優)` の形で立っている記事を
  `/wiki/<名前>` では拾えないことがある。その規模は測っていない
- **Robot policy と robots.txt のどちらが優先かの運営者の見解**。読んだ範囲では決まらない
- **自己申告の UA で大量に引いたときの挙動**。測定した範囲では 403 も 429 も出ていない

---

## 8. 出典

- [`docs/research/actor-kana-sources-2026-09-20.md`](../research/actor-kana-sources-2026-09-20.md) — 取得率の測定
- <https://ja.wikipedia.org/robots.txt> / <https://www.wikidata.org/robots.txt> /
  <https://query.wikidata.org/robots.txt> — 2026-09-20 確認
- <https://wikitech.wikimedia.org/wiki/Robot_policy> — 2026-09-20 確認
- <https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy> — 2026-09-20 確認
- <https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use> — 2026-09-20 確認
- <https://www.wikidata.org/wiki/Wikidata:Licensing> — 2026-09-20 確認
- <https://ja.wikipedia.org/wiki/Wikipedia:ウィキペディアを二次利用する> — 2026-09-20 確認
- <https://dumps.wikimedia.org/jawiki/latest/> — 2026-09-20 確認
