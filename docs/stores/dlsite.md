# DLsite

読者: `crawler/adapters/dlsite.ts` を触る前の人
更新: robots.txt を取り直したら (差分が無くても最終確認日を更新する)。使う URL の形やセレクタを変えたら
削除: DLsite を対応ストアから外したら

実装: `crawler/adapters/dlsite.ts` / `crawler/discovery/dlsite-sitemap.ts`
共通の原則は [`README.md`](./README.md)。

---

## 1. robots.txt

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
`garumani_index.xml` の 7 本。

ここから導けること:

- **`Crawl-delay: 10` は `User-agent: *` グループにあり、パスの限定が無い。**
  したがって検索 HTML だけでなく `/home/api/=/product.json` を含む**すべてのパス**に及ぶ
- **`per_page` を含む検索 URL は、1 ページ目だけが許可されている。**
  `Disallow` が 2 ページ目以降を含めて禁じ、`Allow` が `page/1/` を戻している。
  「`per_page` は禁止されている」は誤読である (§4)
- **`per_page` を含まない検索 URL は、どのページも `Disallow` に一致しない。**
  パターンが `/per_page/` という文字列を必須にしているため。
  つまり `…/order/release_d/page/2` は**字面のうえでは許可されている** (§6 に運用上の判断)
- 使っている `/home/fsr/=/…` と `/garumani/fsr/=/…` は `Disallow: /*search/result` に
  一致しない (パスに `search/result` という文字列が出てこない)
- `/*/author/list/` が禁止されているので、**クリエイター一覧から声優を列挙する経路は使えない**
- 年齢確認 (`/*adultcheck/`、`/js/adultcheck.js`) は禁止。一度もアクセスしていない

---

## 2. レート間隔

> **実装の値は `crawler/lib/fetch.ts` の `rateLimitFor()` が持つ。食い違ったらコードが正。**
> この節は、なぜその値なのかを書く場所であって、値を複製する場所ではない。

キーは `dlsite`。**全パス共通**である。

根拠は robots.txt の `Crawl-delay` (§1 に引用)。この指定は `User-agent: *` グループにあり
パスの限定が無いので、検索 HTML だけでなく `product.json` にも及ぶ。

**以前は `product.json` だけを短くしていた。これは誤り**だった。「JSON API は負荷が軽い」
という理由はこちらの都合でしかなく、相手の指定より短い。全パスを同じ間隔に揃えている。

### この間隔から出る取得コスト

間隔を守ったときの所要時間。**声優起点にした根拠** (`docs/decisions/0002-actor-first-crawling.md`)。

| 取り方 | 規模 | 所要時間 |
|---|---:|---:|
| 声優起点 (採用) | 対象声優ぶんの検索 × 2 フロア | 約 14.2 時間 |
| sitemap 全件 | 68,321 作品 | 約 190 時間 |

**13 倍の差**がある。sitemap 全件は「AniList に居ない声優の発見」にしか要らず、それは対象外。
間隔を変えたらこの表も計算し直すこと。**取るフロアを増やしたときも同じ。**
声優起点の往復はフロアの数に比例する (`/home/` 1 フロアだけなら約 7.1 時間)。

**この 14.2 時間は下限。** 1 声優 1 フロア 1 ページで数えているが、総件数が 1 ページに
収まらないフロアでは古い順の 1 ページ目も引くので、その声優だけ往復が 1 回増える
(`/garumani/` で測定した 10 名のうち 1 名がこれに当たる。下の「既知の落とし穴」)。
新規作品の `product.json` はこれとは別に要る。

---

## 3. 使う URL

### フロア

DLsite はパスの先頭でフロアが分かれる。検索 URL の形もセレクタもフロア間で同じで、
違うのは年齢の指定だけ。**最終確認日: 2026-09-21。**
フロアの名前と対象は、`/home/` の検索結果 HTML
(`crawler/.cache/snapshots/dlsite/search-*.html`) に埋まっているフロア切り替えリンクと
「他のフロアで検索する」リンクの文言から取った。

| パス | サイト側の文言 | 年齢 | 本プロジェクトの扱い |
|---|---|---|---|
| `/home/` | 全年齢 | 全年齢のみ | **取得している** |
| `/garumani/` | 「女性向け 全年齢へ」「女性向け（全年齢）作品を検索する」 | 全年齢のみ | **取得している** ([`decisions/0011`](../decisions/0011-dlsite-garumani-floor.md)) |
| `/girls/` | 「女性向け TL/BLへ」「女性向け（R18）乙女向け/TL作品を検索する」 | R18 を含む | 取得しない |
| `/bl/` | 「女性向け（R18）BL作品を検索する」 | R18 を含む | 取得しない |
| `/maniax/` | 「男性向け R18へ」 | R18 を含む | 取得しない |

作品 ID はフロアをまたいで 1 つの体系で、同じ作品が複数のフロアに出ても ID は同じ。
接頭辞は `product.json` の `work_category` と対応し、`RJ` が `doujin`、`BJ` が `books` である。
**`/home/` の声優検索で `BJ` が出た例はまだ無い** (2026-09-18 に保存したスナップショットの
異なり 200 件と、2026-09-20 の測定の範囲。`docs/research/dlsite-female-floors-2026-09-20.md`)。
`/garumani/` はその逆で、固定データに残した 1 ページ目 5 件はすべて `BJ` である
(`crawler/fixtures/dlsite-search-garumani-saito-souma.html`、2026-09-21 取得)。

### 声優名の検索 (1 ページ目のみ)

```
https://www.dlsite.com/{floor}/fsr/=/language/jp/keyword_creater/"{名前}"/work_type_category[0]/audio/order/{order}/page/1
```

- `{floor}` は `home` か `garumani`。**両方を引く** ([`decisions/0011`](../decisions/0011-dlsite-garumani-floor.md))。
  フロアで違うのはパスの先頭だけで、`pager.count` も一覧のセレクタも同じ位置にある (2026-09-21 実測)。
  **どちらもフロア全体が全年齢なので `age_category` は付けない**
- 名前はダブルクォートで囲んで URL エンコードする (`%22`)。完全一致になり部分一致の別人を拾わない
- `{order}` は `release_d` (新しい順・既定) か `release` (古い順)
- 許可の根拠: `per_page` を含まないので `Disallow: /*/fsr/=/*/per_page/*/page/` に一致しない。
  また `page/1` は `Allow: /*/fsr/=/*/per_page/*/page/1/` の意図とも矛盾しない。
  フロアを名指しで禁じている行に `/home/` も `/garumani/` も無い (§1)
- キーワードを外せば新着一覧になるのはどちらのフロアも同じ

### 作品詳細 API

```
https://www.dlsite.com/home/api/=/product.json?workno=RJ01698658
```

- 禁止行に一致するパスが無い。`Crawl-delay: 10` は適用される (§2)
- **必ず 1 件ずつ引く**。カンマ区切りで複数 workno を渡すと空配列が返る
- **パスの `/home/` はフロアと関係ない。** `BJ` で始まる他フロアの作品もここから引ける (2026-09-20 実測)

### 正規の商品 URL (保存する `productUrl`)

```
https://www.dlsite.com/{floor}/work/=/product_id/{workno}.html
```

一覧の `href` をそのまま使う。取れなかったときだけ**引いたフロア**で組み立てる。
作品が属するフロアとは限らないが、その一覧に出た以上そのフロアの URL では開ける。

### sitemap (現在は使っていない)

```
https://www.dlsite.com/modpub/sitemap-xml/indexes/home_index.xml
```

robots.txt の `Sitemap:` 行に載っているので許可されている。
全件発見の調査 (`docs/research/discovery-spike-2026-09-18.md`) で使ったが、**対象声優を AniList 単独で
定義した時点で不要になった** (`docs/decisions/0002-actor-first-crawling.md`)。実装は `crawler/discovery/dlsite-sitemap.ts` に残してある。

---

## 4. 使ってはいけない URL

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


---

## 5. 取得できる項目 / できない項目

### 検索結果 HTML (サーバー側描画済み)

| 項目 | 可否 | セレクタ |
|---|:--:|---|
| 作品 ID (workno) | ○ | `li[data-list_item_product_id]` (`ul#search_result_img_box` の子)。`/garumani/` では `BJ…` になる |
| タイトル / 商品 URL | ○ | `dd.work_name a[href]` (`title` 属性が省略記号なしの完全なタイトル) |
| サークル名 | ○ | `dd.maker_name > a` |
| 声優名 | △ **代表 1 名のみ** | `dd.maker_name span.author a` |
| 現在価格 | ○ | `dd.work_price_wrap > .work_price .work_price_base`。持たない ([`decisions/0008`](../decisions/0008-no-price-no-availability.md)) |
| 定価 | ○ | `dd.work_price_wrap > .strike .work_price_base`。持たない ([`decisions/0008`](../decisions/0008-no-price-no-availability.md)) |
| 割引率バッジ | ○ | `20%OFF` の表示。持たない ([`decisions/0008`](../decisions/0008-no-price-no-availability.md)) |
| 作品種別 | ○ | `div.work_category` の class `type_SOU` (SOU = ボイス・ASMR) |
| 表紙 | ○ | `thumb-with-ng-filter-block` の `:thumb-candidates` 属性。`resize/images2` → `modpub/images2`、`_240x240.jpg` → `.jpg` で原寸 |
| 総件数 | ○ | 埋め込み `<script>` の `"pager":{"count":N,"have_to_paginate":bool}` |
| **発売日** | **×** | 一覧に無い。`product.json` が要る |
| **声優全員** | **×** | 同上 |

### `product.json`

使うキー: `workno, work_name, maker_name, maker_id, regist_date, age_category,
age_category_string, work_type, work_type_string,
image_main.file_name, creaters.voice_by[].name, genres[].name, on_sale, site_id`。
`price` と `official_price` は読まない。持たない ([`decisions/0008`](../decisions/0008-no-price-no-availability.md))

| 項目 | 可否 | 備考 |
|---|:--:|---|
| 発売日 | ○ | `regist_date` (`2026-09-19 16:00:00` の形) |
| 声優全員 | ○ | `creaters.voice_by[].name`。**一覧の `span.author` は代表 1 名なので必ずこちらを使う** |
| 年齢区分 | ○ | `age_category`。**1 だけが全年齢**。2 (R15) も 3 (R18) も `r18` に寄せる |
| ジャンル | ○ | `genres[].name` |
| ストア区分 | ○ | `site_id` → `StoreListing.storeSection`。**リクエストしたフロアではなく作品の所属**を返す。`/home/` の検索結果にも `girls` や `bl` の作品が混ざる。一覧からは決まらないので、詳細を取れたときだけ埋まる |
| 作品の出自 | ○ | `work_category` (`doujin` / `books`)。ID の接頭辞 `RJ` / `BJ` と対応する (現在は取得していない) |
| 男性向け / 女性向け | ○ | `sex_category`。女性向けが 2 (2026-09-20 実測)。現在は取得していない |
| 予約作品か | ○ | `is_reserve_work`。true なら `regist_date` が未来になりうる (現在は取得していない) |
| セール終了日時 | ○ | `campaign_end_date` (現在は取得していない) |
| 販売中の印 | △ | `on_sale`。販売中の作品では 1 (2026-09-20、`crawler/fixtures/` の product.json で確認)。販売終了の作品でどの値になるかは未確認。現在は取得していない |
| 役名 | × | 持っていない |
| 別名義の根拠 | × | §6 |

---

## 6. 既知の落とし穴

- **`per_page` は無視される。** 位置を変えても値を 10 に下げても既定件数 (30) が返る。
  件数を伸ばす手段は「並び順違いの 1 ページ目を足す」ことしかない
- **`order/release_d` は RJ 番号順ではなく発売日順。** 一覧の 10 番目と 11 番目で RJ 番号が
  7.7 万〜15 万古いのに発売日が当日、という並びが実測された (2026-09-19)。
  RJ 番号の降順でサンプリングすると新作を取りこぼす
- **robots の字面では 2 ページ目以降も許可されている** (`per_page` を含まないため)。
  それでも**運用として 1 ページ目に固定する**。`per_page` 付きで 2 ページ目以降を禁じている以上、
  ページ送りを避けたいという意図は明らかで、かつ 1 ページ目だけで足りるため。
  「robots.txt が 2 ページ目以降を禁じている」という言い方は**字面としては不正確**である
  (根拠: `docs/research/new-release-feeds-2026-09-19.md` の DLsite の節)
- **ジャンルに「ドラマ」「シチュエーション」という語は出ない。** 実データ 200 件で 0 件。
  ドラマ作品を見分けられるのは**タイトルだけ** (判定規則は `src/domain/category.ts`)
  - `product.json` 200 件のジャンル上位: ASMR 155 / バイノーラル・ダミヘ 138 / 癒し 134 /
    耳かき 109 / 萌え 65 / ささやき 64 / 日常・生活 46 / ラブラブ・あまあま 40 / 健全 29 /
    人外娘・モンスター娘 24 / 学校・学園 24 / ほのぼの 21 / 添い寝 18 / ラブコメ 18 / 百合 18 /
    シリーズもの 12 / マッサージ 12 / ネコミミ 12 / 先輩・後輩 11 / 歴史・時代物 10 / 制服 9
  - `work_type` は **200 件すべて `SOU`**。全年齢音声で他の種別はほぼ出てこない
  - ジャンルが空の作品が 9 件 (セット商品など)。9 件すべてタイトルに「ASMR」が入っていた
  - 「ボイスドラマ」「ドラマCD」を含むタイトルが 19 件。新規則を当てると asmr 181 / audio_drama 19
  - **既知の取りこぼし**: 「歴史/時代物」だけが付いた連作ドラマ (『幕末動乱美少女伝』など 8 件) は
    ジャンルにもタイトルにもドラマを示す語が無いので `asmr` に落ちる
- **別名義の根拠は得られない。** スナップショット 2,275 件で `creaters` の id と name は完全な
  1 対 1 で、同じ id に複数名義の例は 0 件。1 つの id が voice_by と music_by にまたがる例は
  138 件あり id が人単位の識別子であることは確かだが、**名義はまたがない**。
  声優個人のプロフィールページも存在しない (プロフィールがあるのはサークルのみ)
- **maniax は home の上位集合ではない。** 斉藤壮馬は home に 1 件あるが maniax には 0 件だった
- **`/home/` は「全年齢の同人」であって「全年齢のすべて」ではない。** `/garumani/` にある
  商業 (`BJ`) の女性向け全年齢音声は `/home/` の検索結果に出ない。
  男性声優ではここが大きく効き、斉藤壮馬は `/home/` 1 件 (2026-09-18 実測) に対し
  `/garumani/` 52 件 (2026-09-20 実測) だった
  (`docs/research/dlsite-female-floors-2026-09-20.md`)。
  **これが 2 フロアを引く理由である** ([`decisions/0011`](../decisions/0011-dlsite-garumani-floor.md))
- **総件数はフロアごとに返る。** 網羅率はフロアの和で見ているので、同じ作品が両方のフロアに
  出ると取得件数と和が一致しない。網羅率が 100% に届かないことは取りこぼしの証明ではない
- **`/garumani/` の新着一覧には発売日が未来の予約作品が出た** (2026-09-20 実測)。
  `/home/` では 2026-09-19 の 1 回の観測で見えていない (「未確認の項目」)。
  一覧 HTML に「予約」の文字は出ないので、見分けるには `product.json` の `is_reserve_work` が要る
- 音声カテゴリの総数は home 8,970 / maniax 76,962 (2026-09-18 実測)。
  全年齢音声カテゴリ全体は 8,981 件・300 ページ (2026-09-19 実測)
- **`/home/` では 1 声優あたりの作品数が少ない。** 上田麗奈の全年齢音声作品は全期間で 27 件で、
  `pager.count` と実取得件数が一致した。30 件を超えうるのは 245 名義中 4 名義 (2%) で、
  いずれも同人 ASMR 専業で AniList に居ない = 対象外。対象に入る層の最多は富田美憂の年換算 24 件。
  **`/garumani/` はこの限りではない。** 測定した 10 名のうち斉藤壮馬が 52 件で、
  1 ページ 30 件の上限に当たっている (`docs/research/dlsite-female-floors-2026-09-20.md`)
- **セールが常態。** 検索結果 HTML から現在価格・定価・割引率バッジ (`20%OFF`) まで取れる。
  実測ではセール中が 41%、新作割引を除く値引き中が 21%、セール期間の中央値は 13 日。
  フォロー 10 人・200 作品なら 1 日 3 件程度が新規にセールになる。
  セール終了日時だけは `product.json` の `campaign_end_date` が要る
- 新作の量は **1 日あたり約 6.4 件**。全体の新着一覧 1 ページ目 30 件で 4.7 日ぶんをカバーする

---

## 7. 未確認の項目

- **`/home/` で予約作品 (発売日が未来) が `order/release_d` の一覧に出るかどうか。**
  2026-09-19 の 1 回の観測では 1 ページ目に「予約」の文字が 0 回で、先頭作品の `regist_date` も
  過去だった。ただし 1 回の観測なので「たまたま無かった」可能性を排除できていない。
  `/garumani/` では出ることが 2026-09-20 に分かっている (「既知の落とし穴」)
- 全年齢音声カテゴリの日次新作数 6.4 件/日 の安定性 (1 日ぶんの観測しかない)
- `campaign_end_date` の形式と精度 (セール検出を始める場合に要確認)
- 検索結果に出ない作品があるか (`pager.count` と実取得件数が一致しないケースの内訳)
- `/girls/` と `/bl/` の全年齢作品が `/home/` にすべて含まれるか。
  確かめたのは作品 1 件と声優 5 名の件数だけ
- `/garumani/` が返す `site_id` の種類。実測で出たのは `bldrama` と `girlsdrama` の 2 つだが、
  `Sitemap:` 行に `girlspro` と `blpro` もある
- `sex_category` の値の意味。女性向けの作品が 2 であることは実測した。
  1 が入る作品は `crawler/fixtures/dlsite-product-RJ01698658.json` にあるが、1 が何を指すかは未確認
- `BJ` の商業音声で、女性向けでないもの (`/books/` など他のフロア) を `/home/` が拾えているか

---

## 8. 出典

- [`docs/research/discovery-spike-2026-09-18.md`](../research/discovery-spike-2026-09-18.md) —
  sitemap 全件 68,321 作品、AniList との交差 57 人、90 日 75 件
- [`docs/research/adult-scope-2026-09-18.md`](../research/adult-scope-2026-09-18.md) —
  robots.txt の全文確認、maniax の対照実験、別名義の実測
- [`docs/research/new-release-feeds-2026-09-19.md`](../research/new-release-feeds-2026-09-19.md) —
  robots の再確認、全体の新着一覧、1 日あたりの新作数、`order/release_d` が発売日順である証拠
- [`docs/research/dlsite-female-floors-2026-09-20.md`](../research/dlsite-female-floors-2026-09-20.md) —
  女性向け 3 フロアの切り分け、声優 10 名の件数差、フロアをまたぐ作品 ID、予約作品
- [`docs/decisions/0002-actor-first-crawling.md`](../decisions/0002-actor-first-crawling.md) — 声優起点
- [`docs/decisions/0003-no-r18-keep-bl.md`](../decisions/0003-no-r18-keep-bl.md) — R18 を載せない
- [`docs/decisions/0011-dlsite-garumani-floor.md`](../decisions/0011-dlsite-garumani-floor.md) — 引くフロア
