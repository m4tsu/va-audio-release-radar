# DLsite

読者: `crawler/adapters/dlsite.ts` を触る前の人。DLsite に何をしてよいか、何が起きるかを確かめるときに読む
更新: robots.txt を取り直したら (差分が無くても最終確認日を更新する)。DLsite の振る舞いについて新しく観測したら
削除: DLsite を対応ストアから外したら

URL の形、セレクタ、読むキーは `crawler/adapters/dlsite.ts` が持つ。共通の原則は [`README.md`](./README.md)。

---

## robots.txt

**最終確認日: 2026-09-21** (`https://www.dlsite.com/robots.txt`。下記の引用行は 2026-09-19 の記述から変化なし)

グループは `User-agent: dotbot` / `User-agent: Eyeotabot` (どちらも `Disallow: /`) と
`User-agent: *` の 3 つ。**こちらに適用されるのは `User-agent: *`** で、そこに 30 行ほどの
`Disallow` と 1 行の `Allow`、`Crawl-delay` がある。このプロジェクトに関係する行をそのまま引く。

```
User-agent: *
Disallow: /*module
Disallow: /*action
Disallow: /*adultcheck/
Disallow: /*/mypage
Disallow: /*search/result
Disallow: /*/cart
Disallow: /*/author/list/
Disallow: /*/fsr/=/*/per_page/*/page/
Disallow: /js/adultcheck.js
Disallow: /hana/
Disallow: /booksl/
Disallow: /pro2/
Allow: /*/fsr/=/*/per_page/*/page/1/
Crawl-delay: 10
```

(全文ではない。16 本の `Sitemap:` 行と、本プロジェクトが触らないパスの行は省いた。
`/*/fsr/` と `per_page` に関する行は上記の 2 行がすべて)

**フロアを名指しで禁じている行は `/hana/` `/booksl/` `/pro2/` の 3 行だけ。**
`/home/` `/garumani/` `/girls/` `/bl/` `/maniax/` はどれにも一致しない。
検索パスに関する行にもフロアの区別が無く、`Crawl-delay: 10` は全フロア共通に及ぶ。

`Sitemap:` 行 16 本のうち女性向けに当たるのは `girls_index.xml` / `girlspro_index.xml` /
`girlsdrama_index.xml` / `bl_index.xml` / `blpro_index.xml` / `bldrama_index.xml` /
`garumani_index.xml` の 7 本。sitemap は `Sitemap:` 行に載っているので取得してよい。

ここから導けること:

- **`Crawl-delay: 10` は `User-agent: *` グループにあり、パスの限定が無い。**
  したがって検索 HTML だけでなく `/home/api/=/product.json` を含む**すべてのパス**に及ぶ
- **`per_page` を含む検索 URL は、1 ページ目だけが許可されている。**
  `Disallow` が 2 ページ目以降を含めて禁じ、`Allow` が `page/1/` を戻している。
  「`per_page` は禁止されている」は誤読である (「使ってはいけない URL」)
- **`per_page` を含まない検索 URL は、どのページも `Disallow` に一致しない。**
  パターンが `/per_page/` という文字列を必須にしているため。
  つまり `…/order/release_d/page/2` は**字面のうえでは許可されている** (運用上の判断は「既知の落とし穴」)
- `/home/fsr/=/…` と `/garumani/fsr/=/…` は `Disallow: /*search/result` に
  一致しない (パスに `search/result` という文字列が出てこない)
- `/home/api/=/product.json` はどの禁止行にも一致しない
- `/*/author/list/` が禁止されているので、**クリエイター一覧から声優を列挙する経路は使えない**
- 年齢確認 (`/*adultcheck/`、`/js/adultcheck.js`) は禁止。一度もアクセスしていない

---

## レート間隔

根拠は robots.txt の `Crawl-delay` (「robots.txt」に引用)。この指定は `User-agent: *` グループにあり
パスの限定が無いので、検索 HTML だけでなく `product.json` にも及ぶ。
「JSON API は負荷が軽い」はこちらの都合でしかなく、`product.json` だけ間隔を短くする根拠にならない。
全パスを 1 つの間隔に揃える。

この間隔では、sitemap 全件を引く取り方は声優起点の検索より 1 桁以上長くかかる。
これが声優起点にした根拠である (`docs/decisions/0002-actor-first-crawling.md`。
sitemap の作品数は [`discovery-spike-2026-09-18.md`](../research/discovery-spike-2026-09-18.md))。
声優起点の往復は引くフロアの数に比例する。

---

## 使ってはいけない URL

| 形 | 理由 |
|---|---|
| `…/per_page/100/page/2` 以降 | `Disallow: /*/fsr/=/*/per_page/*/page/` に一致する。`Allow` が戻しているのは `page/1/` だけ |
| `/*/author/list/` 配下 | robots が禁止。クリエイター一覧からの声優列挙はできない |
| `/*adultcheck/`、`/js/adultcheck.js` | robots が禁止。年齢確認の経路には触れない |
| `/*/cart`、`/*/mypage` | robots が禁止 |
| `product.json?workno=RJ1,RJ2,…` | robots ではなく仕様の問題。複数渡すと空配列が返る |
| `/hana/`、`/booksl/`、`/pro2/` 配下 | robots が名指しで禁じている |
| `/maniax/` の検索 | robots は禁じていない (`/maniax/` を名指しした行は無く、Cookie も年齢確認も不要で 200 が返る)。**禁止ではなく方針として使わない**。R18 は載せない (`docs/decisions/0003-no-r18-keep-bl.md`) |
| `/girls/`、`/bl/` の検索 | 同上。R18 を含むフロアなので方針として使わない。`age_category[0]/general` を足せば全年齢だけになるが、測定した範囲では結果が `/home/` と重なり新しい作品が出なかった (`docs/research/dlsite-female-floors-2026-09-20.md`) |
| 作品ページの「リンクをコピー」で得られる `dlsite.com` の URL (`utm_*` だけが付く) | アフィリエイト ID が入らず成果が付かない。管理画面が出力する `dlaf.jp` の形を使う |

---

## 既知の落とし穴

### フロア

- **フロアはパスの先頭で分かれ、サイト側の文言で年齢が分かる** (2026-09-21 確認。
  `/home/` の検索結果 HTML のフロア切り替えリンクと「他のフロアで検索する」リンクの文言)。
  `/home/` は全年齢、`/garumani/` は「女性向け（全年齢）」、`/girls/` は「女性向け（R18）乙女向け/TL」、
  `/bl/` は「女性向け（R18）BL」、`/maniax/` は「男性向け R18」。
  検索 URL の形と一覧の構造はフロア間で同じ (2026-09-21 実測)。引くフロアは
  [`decisions/0011`](../decisions/0011-dlsite-garumani-floor.md)
- **作品 ID はフロアをまたいで 1 つの体系。** 同じ作品が複数のフロアに出ても ID は同じ。
  接頭辞は `product.json` の `work_category` と対応し、`RJ` が `doujin`、`BJ` が `books` である。
  `/home/` の声優検索で `BJ` が出た例は 2026-09-18 のスナップショットと 2026-09-20 の測定の範囲で無い
  (`docs/research/dlsite-female-floors-2026-09-20.md`)。`/garumani/` の固定データ
  (`crawler/fixtures/dlsite-search-garumani-saito-souma.html`、2026-09-21 取得) の 5 件はすべて `BJ`
- **`/home/` は「全年齢の同人」であって「全年齢のすべて」ではない。** `/garumani/` にある
  商業 (`BJ`) の女性向け全年齢音声は `/home/` の検索結果に出ない。男性声優で差が大きい
  (件数は `docs/research/dlsite-female-floors-2026-09-20.md`)。
  **これが 2 フロアを引く理由である** ([`decisions/0011`](../decisions/0011-dlsite-garumani-floor.md))
- **`product.json` のパスの `/home/` はフロアと関係ない。** `BJ` で始まる他フロアの作品もここから引ける (2026-09-20 実測)
- **`product.json` の `site_id` はリクエストしたフロアではなく作品の所属を返す。** `/home/` の検索結果にも
  所属が `girls` や `bl` の作品が混ざる。`/garumani/` の作品は所属が `bldrama` / `girlsdrama` で返る
  (`docs/research/dlsite-female-floors-2026-09-20.md`)。一覧からは所属が決まらない
- **総件数はフロアごとに返る。** 同じ作品が両方のフロアに出ると、フロアの和と取得件数が一致しない。
  網羅率が 100% に届かないことは取りこぼしの証明ではない
- **maniax は home の上位集合ではない。** 斉藤壮馬は home に 1 件あるが maniax には 0 件だった
  (`docs/research/adult-scope-2026-09-18.md`)

### 一覧と検索

- **`per_page` は無視される。** 位置を変えても値を 10 に下げても既定件数 (30) が返る (2026-09-19 実測)。
  件数を伸ばす手段は「並び順違いの 1 ページ目を足す」ことしかない
- **`order/release_d` は RJ 番号順ではなく発売日順。** 一覧の 10 番目と 11 番目で RJ 番号が
  7.7 万〜15 万古いのに発売日が当日、という並びが実測された (2026-09-19)。
  RJ 番号の降順でサンプリングすると新作を取りこぼす
- **robots の字面では 2 ページ目以降も許可されている** (`per_page` を含まないため)。
  それでも**運用として 1 ページ目に固定する**。`per_page` 付きで 2 ページ目以降を禁じている以上、
  ページ送りを避けたいという意図は明らかで、かつ 1 ページ目だけで足りるため。
  「robots.txt が 2 ページ目以降を禁じている」という言い方は**字面としては不正確**である
  (根拠: `docs/research/new-release-feeds-2026-09-19.md` の DLsite の節)
- **一覧の声優は代表 1 名だけ。** 新着一覧には代表 1 名すら空の作品がある。出演者全員と発売日は
  一覧に無く、`product.json` が要る
- **新着一覧の `pager.count` はカテゴリ全体の作品数であって新着数ではない。**
  新着一覧の件数と新作の量は [`new-release-feeds-2026-09-19.md`](../research/new-release-feeds-2026-09-19.md)、
  一覧に留まる日数はフロアで違う (`/garumani/` は
  [`dlsite-female-floors-2026-09-20.md`](../research/dlsite-female-floors-2026-09-20.md))
- **`/garumani/` の新着一覧には発売日が未来の予約作品が出た** (2026-09-20 実測)。
  `/home/` では 2026-09-19 の 1 回の観測で見えていない (「未確認の項目」)。
  一覧 HTML に「予約」の文字は出ないので、見分けるには `product.json` の `is_reserve_work` が要る
- **`/home/` では 1 声優あたりの作品数が少なく、1 ページ 30 件に収まる声優がほとんど**
  (`docs/research/adult-scope-2026-09-18.md`、`docs/research/discovery-spike-2026-09-18.md`)。
  **`/garumani/` はこの限りではなく**、30 件の上限に当たる声優がいる
  (`docs/research/dlsite-female-floors-2026-09-20.md`)
- **一覧には現在価格・定価・割引率が出る。** セール終了日時だけは `product.json` の `campaign_end_date` にある。
  価格は持たない ([`decisions/0008`](../decisions/0008-no-price-no-availability.md))

### `product.json` の中身

- **`age_category` は 1 だけが全年齢。** 2 が R15、3 が R18
- **`on_sale` は今買えるなら 1、買えないなら 0。** 一覧に出た作品は必ず 1 で、0 は 5 日経っても 0 だった
  ([`dlsite-on-sale-2026-09-23.md`](../research/dlsite-on-sale-2026-09-23.md))
- **`sex_category` は女性向けが 2** (2026-09-20 実測)
- **ジャンルに「ドラマ」「シチュエーション」という語は出ない。** ドラマ作品を見分けられるのは
  タイトルだけ。ジャンルにもタイトルにもドラマを示す語が無い連作ドラマがある
  (件数と例は `src/domain/category.ts` と `docs/research/discovery-spike-2026-09-18.md`)
- **別名義の根拠は得られない。** `creaters` の id と name は 1 対 1 で、同じ id に複数名義の例は無い。
  id は人単位の識別子だが、名義はまたがない。声優個人のプロフィールページも存在しない
  (プロフィールがあるのはサークルのみ)。実測は `docs/research/adult-scope-2026-09-18.md`

### アフィリエイトリンク

- **リンクの形の出どころは DLsite アフィリエイトの管理画面が作品ごとに出力するリンク** (2026-09-24 確認)。
  ホストは `dlsite.com` ではなく `dlaf.jp`
- **リンクのフロアは作品の所属 (`site_id`) で決まり、検索したフロアではない** (2026-09-24 確認)。
  所属が `girls` の `RJ01048863` は `product_url` が `/home/` だが、管理画面のリンクは `girls` だった。
  `/garumani/` の検索で出た `BJ02911418` のリンクは `garumani` だった

---

## 未確認の項目

- **`/home/` で予約作品 (発売日が未来) が `order/release_d` の一覧に出るかどうか。**
  2026-09-19 の 1 回の観測では 1 ページ目に「予約」の文字が 0 回で、先頭作品の `regist_date` も
  過去だった。ただし 1 回の観測なので「たまたま無かった」可能性を排除できていない。
  `/garumani/` では出ることが 2026-09-20 に分かっている (「既知の落とし穴」)
- **未発売の作品が `on_sale: 0` を返すか**
- 全年齢音声カテゴリの日次新作数の安定性 (1 日ぶんの観測しかない。
  [`new-release-feeds-2026-09-19.md`](../research/new-release-feeds-2026-09-19.md))
- `campaign_end_date` の形式と精度 (セール検出を始める場合に要確認)
- 検索結果に出ない作品があるか (`pager.count` と実取得件数が一致しないケースの内訳)
- `/girls/` と `/bl/` の全年齢作品が `/home/` にすべて含まれるか。
  確かめたのは作品 1 件と声優 5 名の件数だけ
- `/garumani/` が返す `site_id` の種類。実測で出たのは `bldrama` と `girlsdrama` の 2 つだが、
  `Sitemap:` 行に `girlspro` と `blpro` もある
- `sex_category` の値の意味。女性向けの作品が 2 であることは実測した。
  1 が入る作品は `crawler/fixtures/dlsite-product-RJ01698658.json` にあるが、1 が何を指すかは未確認
- アフィリエイトリンクのパスの `t/n` の意味
- アフィリエイトリンクのフロアが、所属 `bl` / `pro` の作品でも所属と同じ名前になるか。管理画面でリンクを出して見る
- `BJ` の商業音声で、女性向けでないもの (`/books/` など他のフロア) を `/home/` が拾えているか

---

## 出典

- [`docs/research/discovery-spike-2026-09-18.md`](../research/discovery-spike-2026-09-18.md) —
  sitemap 全件の作品数、AniList との交差、声優ごとの作品数
- [`docs/research/adult-scope-2026-09-18.md`](../research/adult-scope-2026-09-18.md) —
  robots.txt の全文確認、maniax の対照実験、別名義の実測
- [`docs/research/new-release-feeds-2026-09-19.md`](../research/new-release-feeds-2026-09-19.md) —
  robots の再確認、全体の新着一覧、1 日あたりの新作数、`order/release_d` が発売日順である証拠
- [`docs/research/dlsite-female-floors-2026-09-20.md`](../research/dlsite-female-floors-2026-09-20.md) —
  女性向け 3 フロアの切り分け、声優 10 名の件数差、フロアをまたぐ作品 ID、予約作品
- [`docs/research/dlsite-on-sale-2026-09-23.md`](../research/dlsite-on-sale-2026-09-23.md) — `on_sale` の値
- [`docs/research/dlsite-daily-feed-2026-09-21.md`](../research/dlsite-daily-feed-2026-09-21.md) —
  日次の走行 1 回目の件数と所要
- [`docs/research/daily-feed-screened-2026-09-21.md`](../research/daily-feed-screened-2026-09-21.md) —
  新着一覧の既知 ID を引き直さないときの往復の差
- [`docs/decisions/0002-actor-first-crawling.md`](../decisions/0002-actor-first-crawling.md) — 声優起点
- [`docs/decisions/0003-no-r18-keep-bl.md`](../decisions/0003-no-r18-keep-bl.md) — R18 を載せない
- [`docs/decisions/0007-daily-crawl-from-store-feeds.md`](../decisions/0007-daily-crawl-from-store-feeds.md) — 日次の走行
- [`docs/decisions/0011-dlsite-garumani-floor.md`](../decisions/0011-dlsite-garumani-floor.md) — 引くフロア
