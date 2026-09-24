# ポケットドラマ CD (pokedora.com)

読者: `crawler/adapters/pokedora.ts` や `crawler/discovery/pokedora-*.ts` を触る前の人
更新: robots.txt を取り直したら (差分が無くても最終確認日を更新する)。使う URL の形やセレクタを変えたら
削除: ポケットドラマ CD を対応ストアから外したら

実装: `crawler/adapters/pokedora.ts` / `crawler/discovery/pokedora-tags.ts` /
`pokedora-intersect.ts` / `build-pokedora-tags.ts` / `pokedora-directory.ts`
共通の原則は [`README.md`](./README.md)。

運営は株式会社アニメイト (作品ページの `<meta name="author">` に記載)。

---

## 1. robots.txt

**最終確認日: 2026-09-21** (`https://pokedora.com/robots.txt`)。**全文がこれだけである。**
2026-09-18 に保存したものと内容は同じだった。

```
User-Agent: *
Disallow: /cart/*
Disallow: /mypage/*
Sitemap: https://pokedora.com/sitemap.xml
```

ここから導けること:

- **`Crawl-delay` の指定が無い** → 間隔はこちらで決める (§2)
- **商品一覧 `/products/list.php`、商品詳細 `/products/detail.php`、タグ `/tags/` は
  すべて許可されている。** `pageno` / `disp_number` / `store` / `order` などの
  クエリパラメータを禁じる行も無い
- sitemap は index 形式で子が 6 本 (すべて `.xml.gz`):
  `sitemap_page` / `sitemap_corners_1` / `sitemap_features_1` /
  `sitemap_products_1` / `sitemap_products_2` / `sitemap_tags_1`

---

## 2. レート間隔

> **実装の値は `crawler/lib/fetch.ts` の `rateLimitFor()` が持つ。食い違ったらコードが正。**
> この節は、なぜその値なのかを書く場所であって、値を複製する場所ではない。

キーは `pokedora`。

robots.txt に指定が無いので、**こちらの判断**である。
何秒が妥当かは相手にしか分からないため保守的に取った。
声優タグ辞書は 3,161 件の一度きりのバッチで、速く終わらせる必要がない。

実測のスループットは 5.03 秒/リクエスト (2026-09-19、声優タグ辞書の構築時)。
設定した間隔とほぼ一致しており、相手側で絞られてはいない。

---

## 3. 使う URL

### ストア全体の新着一覧

```
https://pokedora.com/products/list.php?mode=search&name=&xfp=0&genre_tag_id=0&order=1&store={men|bl}&disp_number={件数}&pageno={ページ}
```

- `order=1` が新着順 (2=古い順 / 3=人気順 / 4=価格が高い順 / 5=価格が安い順 /
  7=レビューが多い順 / 8=いいねが多い順)。ラベルは `select` の表示による。
  サイト自身が「新規配信順」として `order=2` を指しているリンクもあり、どちらが新着かは確定していない (§7)
- **`disp_number` は効く。ただし受け付ける値が `/tags/` と違う。** 指定なしと `30` はどちらも
  30 件、`100` は 15 件に落ちる (2026-09-21 実測。
  [`pokedora-disp-number-2026-09-21.md`](../research/pokedora-disp-number-2026-09-21.md))。
  総件数は `div.search_count` に出る
- `pageno` がページ送り。`disp_number=100` (1 ページ 15 件) のとき `pageno=2` が
  16〜30 件目を返すことを確認済み
- 許可の根拠: robots が禁じているのは `/cart/*` と `/mypage/*` だけで、`list.php` も
  `order` も `pageno` も禁じられていない
- **日次の走行が使う。** 引くのは一般と BL の 1 ページ目だけで、ページ送りはしない
  ([`decisions/0007`](../decisions/0007-daily-crawl-from-store-feeds.md))。
  1 ページ 15 件が覆う日数は
  [`pokedora-new-releases-2026-09-21.md`](../research/pokedora-new-releases-2026-09-21.md) にあり、
  日次はそれより多い件数で引くので窓はより広い
- **詳細ページを引くのは、一覧に出た作品のうち初めて見たものだけ。** 対象声優が居なくて
  保存しなかった作品も商品 ID を覚えているので、2 日目以降は引き直さない
  ([`decisions/0007`](../decisions/0007-daily-crawl-from-store-feeds.md)、
  往復の差は [`daily-feed-screened-2026-09-21.md`](../research/daily-feed-screened-2026-09-21.md))
- **`div.search_count` の総件数は載せない。** ストア全体の作品数であって新着数ではないので、
  網羅率として記録すると意味を取り違える
- 実測は [`research/pokedora-new-releases-2026-09-21.md`](../research/pokedora-new-releases-2026-09-21.md)

### 声優タグの作品一覧

```
https://pokedora.com/tags/?tag_type=1&tag_id={id}&disp_number=100&store={men|bl}&pageno={n}
```

- `tag_type=1` が声優 (2=シリーズ、3=レーベル、4=原作者・イラストレーター等)
- `disp_number` は 30 / 50 / 100 から選べる。**100 を使う** (§2 の間隔を空けるので 1 往復の価値が大きい)
- 許可の根拠: robots が禁じているのは `/cart/*` と `/mypage/*` だけで、`/tags/` も
  `pageno` も禁じられていない

### 商品詳細

```
https://pokedora.com/products/detail.php?product_id={id}
```

出演声優の全員を取るために必須。

### カバー画像

```
https://pokedora.com/get_image.php?product_id={id}&thumb=large
```

`og:image` を優先し、無ければこの形を組み立てる。

### 声優タグ辞書の sitemap

```
https://pokedora.com/sitemap_tags_1.xml.gz
```

robots の `Sitemap:` 行から辿れる index の子。`.xml.gz` なので `fetchText` ではなく
`kind: "binary"` で取る。

### アフィリエイトリンク

クローラーは使わない。作品ページの「ポケドラで聴く」の送り先で、組み立ては `src/server/affiliate.ts`。
**最終確認日: 2026-09-24。**

- バリューコマースの MyLink。ポケットドラマCD の提携先として MyLink が許可されていることを、
  バリューコマースの管理画面で確かめた
- 形の出どころは管理画面が作品 1 件 (`product_id=101749`) に出したコード。変わるのは `vc_url` だけで、
  そこには作品ページの URL (`store_listings.product_url`) を URL エンコードして入れる。作品 ID から組み直さない
- `sid` (サイト ID) と `pid` (広告スペース ID) は URL に出る公開値。本番の値は `package.json` の `deploy` が渡す
- 管理画面の出力はプロトコル相対 (`//ck.jp...`)。画面は `https:` の URL しか出さないので `https:` を付けている
- **コードには 1x0 の計測画像が `<a>` の中に入っている。** バリューコマースのヘルプ
  (<https://help.valuecommerce.ne.jp/aff/ad/adlink/09/>、2026-09-24 取得) は広告コードの改変を禁じ、
  改変にあたらない変更を `target="_blank"` の追加、`rel` の追加・変更、`alt` の追加などに限っている。
  画像の削除はそこに無いので、画像は大きさと `border` もコードのとおりに出し、`alt=""` だけを足している
- 画像を出すのは作品ページのリンクの中だけ。一覧にはストアへのリンクが無いので、画像も出ない
- `sid` を変えずに `vc_url` だけを作品ごとに差し替えることは、MyLink が決めるリンク先の指定の範囲内と
  運営者が判断した (照会はしていない)

---

## 4. 使ってはいけない URL

| 形 | 理由 |
|---|---|
| `/cart/*` | robots が禁止 |
| `/mypage/*` | robots が禁止 |
| `?store=adt` / `?store=adt-bl` (オトナ向け 2 ストア) | robots は禁じていない。**禁止ではなく方針として取得しない**。年齢認証の背後にあり、AniList 対象声優との一致が 0 名で実利がない。取らなければ Cookie もセッション維持も要らない |
| `list.php?store=adt&age_check=1` + `ECSESSID` Cookie | 同上。年齢認証を通す経路には触れない |
| `/sapi/json.php?query=…&Operation=Suggest&Service=none` | 禁止ではなく**動かない**。JS 内に定義があるが、この引数で叩くと 404 が返る。名前から `tag_id` を引く手段は無い |
| `/tags/` (引数なし) | 404 が返る |
| 商品 sitemap を全件辿る形 | 禁止ではなく**コストが合わない**。`sitemap_products_1/2.xml.gz` の商品 URL は 76,731 件で、§2 の間隔だと 106 時間 (4.4 日) かかる |


**ストアが表示する作品数と sitemap の URL 数は別物。** 表示上の 2,277 件に対し sitemap の商品 URL は 76,731 件 (2026-09-18)。
取得コストは sitemap を実際に数えて見積もる。

---

## 5. 取得できる項目 / できない項目

### 新着一覧 (`list.php`)

タグページと同じ商品カードを使っているので、セレクタは下の「タグページ (一覧)」と同じ。
違うのは次の 3 点。

| 項目 | 可否 | セレクタ / 備考 |
|---|:--:|---|
| 総件数 | ○ | `div.search_count` の `{総件数}件中　{開始} - {終了}件目` の形 |
| ページ番号 | ○ | ページャの `a[onclick]` の `$('#p_pageno').val({ページ番号})` の形。`href` は持たない |
| 価格 (割引中) | ○ | `span.normal_price` ではなく `span.individual_price` + `span.discount_rate` + `span.basic_price` |
| **発売日 / 配信日** | **×** | §6 |

商品カテゴリの `span.product_catgory_el` には `NEW` / `割引` / `特典あり` のバッジが
同じクラスで混ざり、**カテゴリより先に並ぶ**。修飾クラス (`product_catgory_el-new` など) が
付いたものを除かないと、先頭のカテゴリがバッジの語になる。

**新着一覧にはストア全体の商品が出るので、声優タグ経由では出なかった商品カテゴリが入る。**
`オーディオブック` がその例で、区分の対応は `src/domain/category.ts` が持つ。
知らない区分は既定に倒れるので、新しい語が出ていないかは取り込んだ区分を見て確かめる。

### タグページ (一覧)

| 項目 | 可否 | セレクタ |
|---|:--:|---|
| 商品 ID | ○ | `li.product_list_el` 内の `a[href*="product_id="]` |
| タイトル | ○ | `p.product_title a` (`title` 属性が完全なタイトル) |
| 商品カテゴリ | ○ | `span.product_catgory_el` |
| 価格 (税込) | ○ | `span.normal_price`。持たない ([`decisions/0008`](../decisions/0008-no-price-no-availability.md)) |
| ストア区分 | ○ | `a.category_tab_el_link.active` の `data-store` |
| 4 ストアの件数内訳 | ○ | `li.category_tab_el.category_tab_el-{men\|bl\|adt\|adt-bl}` 内の `(66件)` |
| 総件数 | ○ | `8件中 1 - 8件目` の形 |
| 出演声優 | △ **2 名まで** | 一覧の表示は 2 名で打ち切られる。検索自体は全キャストに当たっている |

4 ストアの件数内訳が同じページに出るので、**件数 0 の区分はページを引かずに済ませられる**。

### 商品詳細

| 項目 | 可否 | セレクタ / 備考 |
|---|:--:|---|
| **出演声優 (全員)** | ○ | `div.item_detail_extra` のうちヘッダ (`span.item_detail_extra_header`) が「出演声優」のものの `a[href*="tag_type=1"]`。href から声優の `tag_id` も取れる |
| タイトル | ○ | `h1.item_detail_info_title` |
| 価格 (税込) | ○ | `span.product_price`。**税抜は表示されない**。無料は 0。持たない ([`decisions/0008`](../decisions/0008-no-price-no-availability.md)) |
| カバー画像 | ○ | `meta[property="og:image"]` |
| 商品カテゴリ | ○ | `span.product_catgory_el` (先頭がカテゴリ判定に使う値) |
| レーベル | ○ | `tag_type=3` へのリンク → `makerName` |
| 関連ワード | ○ | `tag_type=4` へのリンク → `genres` |
| ストア区分 | ○ | `select[name="store"] option[selected]` の value が主、JSON-LD の BreadcrumbList が予備 |
| 収録トラック | ○ | トラック名のみ (現在は取得していない) |
| **発売日 / 配信日** | **×** | §6 |
| **再生時間** | **×** | トラック名は出るが尺は出ない |
| **役名** | **×** | §6 |
| シリーズ (`tag_type=2`) | 捨てている | `RawWork` に置く場所が無い。`genres` に混ぜるとジャンルでない語が入る |

**タイトル末尾の `【出演声優：…】` と `.item_detail_info_desc_content` は主要キャストのみ。**
上部 6 名に対し「作品情報」欄は 17 名、という実例がある。**必ず `div.item_detail_extra` を使う。**

---

## 6. 既知の落とし穴

- **発売日が存在しない。** 実 HTML 6 件すべてで「発売日」「配信日」「リリース」が 0 件。
  `<meta>` は `author` と `og:*` のみ、JSON-LD は BreadcrumbList だけで日付フィールドが無い。
  新着順の先頭にある最新商品 2 件でも同じだった
  ([`research/pokedora-new-releases-2026-09-21.md`](../research/pokedora-new-releases-2026-09-21.md))。
  **新着一覧にも出ない。** 発売日は自由記述としてタイトルに入ることがあるだけで
  (`《配信開始は2026年11月6日11:00》…` の形)、項目としては取れない。
  sitemap の `lastmod` はページ更新日なので代理にできない。
  新着判定は「初回発見日」の機構に乗る (`docs/product.md` の「新着」) が、
  **1 ストアだけ日付の意味が違う**ことを UI とドキュメントで明示する
- **`list.php` の `disp_number` は `/tags/` と受け付ける値が違う。** `100` を渡すと 100 件では
  なく 15 件になる。`list.php` のフォームには `disp_number` の `select` が無い。
  日次の走行が `30` を明示しているのはこのため
  (測定は [`pokedora-disp-number-2026-09-21.md`](../research/pokedora-disp-number-2026-09-21.md))
- **`sitemap_products_*.xml.gz` は毎日は再生成されない。** 2026-09-18 と 2026-09-21 で
  URL 数・`product_id` の範囲・`lastmod` の最大がすべて同じで、その時点の新着 3 件が
  入っていなかった。**sitemap の差分を新着検出に使えない**
- **新着順 (`order=1`) の並びの基準は一般と BL で違う。** 一般は sitemap の `lastmod` 降順と
  ほぼ一致するが、BL は一致しない。`product_id` の降順とも一致しない。
  ストア側が持つ日付で並んでいるが、その日付は HTML に出ない
- **1 作品に複数商品がある** (通常版・特典版・ダウンロード版)。当面は別作品として扱う。
  確信が無いものをマージしない。`sitemap_products_1/2` が 76,731 件ある理由の一部でもある
- **役名は取らない。** `役名(CV:声優名)` / `役名 CV:声優名` / `役名:声優名` / 記載なし と
  4 パターン以上あり、単一の正規表現では抽出できない
- **ストア区分の語彙が 2 系統ある。** パンくず (JSON-LD) は一般を `store=home` と書き、
  `select` は `men` と書く。**パンくず側を使うときは `home` を `men` に読み替える。**
  `storeSection` に入るのは `men` / `bl`
- **辞書に無い声優はポケドラを引かない。** 名前から `tag_id` を引く API が無いため。
  `crawler/run.ts` がその声優のストアごと飛ばす (集計表では 0 件ではなく `-` になる)
- **`tag_id` は DB に入れていない。** 492 作品から 638 個の `tag_id` を 3,097 回観測して、
  2 つ以上の表記を持つ `tag_id` は **0 件**だった。リンク文字列がタグ名そのものなので
  1 タグ 1 表記で、別名義の根拠としての価値が現時点でゼロである。
  観測結果は `crawler/.cache/discovery/pokedora-actor-refs.json` に貯めてある。
  将来入れるなら `(store_slug, external_id)` が一意な別テーブルにする。`voice_actor_aliases` は名前の表で
  名寄せの索引になるため、名前でない文字列を混ぜない
- **カテゴリは商品カテゴリの先頭だけで決める。** 実データ 492 件の内訳は
  BLCD 351 / 一般ドラマCD 76 / シチュエーションCD 35 / 音楽 17 / 女性向けドラマCD 11 /
  配信限定シチュエーション 2。関連ワードを見ないのは「あまあま」「学園」のような
  内容の語だから。ASMR の語を含む 3 件もシチュエーション系のカテゴリに置かれていた
- **BL が過半を占める。** 取得対象の延べ 8,534 件 (一般 3,981 / BL 4,553) のうち BL が 53%。
  上位 40 人は BL 件数が一般を上回る人が大半で、この層は既存 2 ストアにほぼ現れていない
- 声優タグ 3,161 件と AniList 対象声優の交差は **1,187 人**、うち作品が 1 件以上あるのは **882 人**。
  1 人あたり中央値 2、上位 10% は 21、最大 148 (古川慎)。
  ポケドラにのみ存在する声優が 1,967 人いるが、これは対象外
- ポケドラを入れると全カタログは 2,756 件から **3 倍以上**になる。
  上位 200 人に絞れば 9.0 時間で対象の 76% を押さえられる
- ストア別の全作品数は 一般 1,366 / BL 911 / オトナ向け 4,373 / オトナBL 317 (2026-09-18 実測)。
  オトナ向けが最大で全体の 63% を占めるが、対象声優との一致は 0 名 (§4)

### 使ってはいけない数字

**「DLsite では取れない 851 人」には根拠がない。** 照合相手が DLsite の全カタログではなく、
発見スパイクの直近 2,085 作品・277 名義しかないため。言えるのは
「ポケドラで作品数が多い層は、DLsite の直近全年齢音声にほぼ出ていない」までである。
確定させるには DLsite 側を声優名で引き直す必要がある。Audible は未計測
(空振りした検索はスナップショットが残らないので、スナップショットからは「作品なし」を導けない)。

### 全件クロールのコスト

**この表がポケドラの見積もりの出典**。時間は §2 の間隔から出しているので、
間隔を変えたら計算し直すこと。

| 段階 | 内容 | コスト |
|---|---|---|
| 1 | 声優タグ辞書の構築 (`sitemap_tags_1.xml.gz` の `tag_type=1` 3,161 件の `<title>` を読む) | 4.4 時間 (一度きり。**実施済み**、4 時間 23 分・失敗 0) |
| 2 | AniList 対象声優との交差 | 0 |
| 3 | 対象声優のタグページ | 1,142 枚 = 1.6 時間 |
| 4 | 出てきた作品の詳細 | 上限 2,277 件 = 3.2 時間 |

**見積もりは 13.4 時間から 4.8 時間になった。** 段階 4 を「延べ 8,593 件」で見積もっていたのを、
**走行中に取り終えた作品を既知集合へ足す**仕組み (`crawler/run.ts` の `markFetched`) で
ユニーク件数に落としたため。1 作品に十数名が出る BL ドラマ CD では、これが無いと
同じ詳細ページを出演者の人数ぶん引き直す。credit は作品に紐づいて既に保存されているので、
2 人目以降で詳細を飛ばしても出演者は落ちない。

段階 4 の上限 2,277 件は、取得対象にしている 一般 + BL 両ストアの全作品数の合計である
(内訳は §6 の「ストア別の全作品数」)。実際はこれより少ない。

---

## 7. 未確認の項目

- **`order=1` が本当に新着順か。** `select` のラベルはそう読めるが、サイト自身が
  「新規配信順一覧」として `order=2` を指すリンクを置いている
- **新着順 (`order=1`) が何の日付で並べているか。** `lastmod` でも `product_id` でも
  ないことは分かっているが、正体は分からない (§6)
- **「NEW」バッジが何日間付くか。** バッジの付いた件数は数えたが、日数に直せない (件数は [`pokedora-new-releases-2026-09-21.md`](../research/pokedora-new-releases-2026-09-21.md))
- **1 ページ目に出ない新商品があるか。** 深いページを引いたのは `disp_number=100` (15 件/ページ) の
  ときの一般の 2 ページ目だけで、これは日次が引く 1 ページ目の範囲に収まっている。
  つまり日次の 1 ページ目より深いところは一度も見ていない
  (引く件数は `crawler/adapters/pokedora.ts` の `FEED_DISP_NUMBER`)
- **一覧から商品が消える条件。** 総件数が減った日があり、非公開化か別ストアへの移動かは見ていない (測定は [`pokedora-new-releases-2026-09-21.md`](../research/pokedora-new-releases-2026-09-21.md))
- **無限スクロール (`section.autopager`) が新着一覧にもあるか。** タグページでは使っているが、
  一覧の HTML では見ていない。JS が何を読むかもブラウザを立ち上げていないので分からない
- DLsite との作品の重複。直近サンプル 2,085 件との照合では 0 件だったが、
  全カタログではないので重複が無いことの証明にはならない
- 利用規約にクローリングを名指しで禁じる条項は無いことを確認済み (第 11 条)。
  ただし robots.txt の最終確認から日が経っている

---

## 8. 出典

- [`docs/research/store-survey-2026-09-18.md`](../research/store-survey-2026-09-18.md) —
  robots.txt 全文、sitemap の構成、タグの `tag_type` 内訳、利用規約
- [`docs/research/pokedora-intersection-2026-09-18.md`](../research/pokedora-intersection-2026-09-18.md) —
  タグ 3,161 件の全件取得、AniList との交差 1,187 人、延べ 8,534 件
- [`docs/research/adult-scope-2026-09-18.md`](../research/adult-scope-2026-09-18.md) —
  4 ストアの件数、年齢認証の仕組み (`ECSESSID`)、オトナ向けの交差 0 名
- [`docs/research/new-release-feeds-2026-09-19.md`](../research/new-release-feeds-2026-09-19.md) —
  sitemap の `lastmod` が新着検出に使えないこと (保存物だけで判断)
- [`docs/research/pokedora-new-releases-2026-09-21.md`](../research/pokedora-new-releases-2026-09-21.md) —
  新着一覧の実測。1 ページの件数、取れる項目、ページ送り、1 日あたりの新作数、
  sitemap が毎日は再生成されないこと
- [`research/pokedora-disp-number-2026-09-21.md`](../research/pokedora-disp-number-2026-09-21.md) —
  `list.php` の `disp_number` が受け付ける値
- `crawler/fixtures/pokedora-list-order1-*.html` — 新着一覧の実 HTML (2026-09-21 取得。`disp_number=100` で 15 件)
- `crawler/adapters/pokedora.ts` のファイル冒頭コメント — 取得手順
