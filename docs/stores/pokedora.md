# ポケットドラマ CD (pokedora.com)

読者: `crawler/adapters/pokedora.ts` や `crawler/discovery/pokedora-*.ts` を触る前の人
更新: robots.txt を取り直したら (差分が無くても最終確認日を更新する)。サイトの挙動について新しく分かったら
削除: ポケットドラマ CD を対応ストアから外したら

URL の形・セレクタ・件数の値は `crawler/adapters/pokedora.ts` と `crawler/discovery/pokedora-*.ts` が持つ。
共通の原則は [`README.md`](./README.md)。

運営は株式会社アニメイト (作品ページの `<meta name="author">` に記載)。

---

## robots.txt

**最終確認日: 2026-09-21** (`https://pokedora.com/robots.txt`)。**全文がこれだけである。**
2026-09-18 に保存したものと内容は同じだった。

```
User-Agent: *
Disallow: /cart/*
Disallow: /mypage/*
Sitemap: https://pokedora.com/sitemap.xml
```

ここから導けること:

- **`Crawl-delay` の指定が無い** → 間隔はこちらで決める (「レート間隔」)
- **商品一覧 `/products/list.php`、商品詳細 `/products/detail.php`、タグ `/tags/` は
  すべて許可されている。** `pageno` / `disp_number` / `store` / `order` などの
  クエリパラメータを禁じる行も無い
- sitemap は index 形式で、子はすべて `.xml.gz`

### 利用規約

クローリングを名指しで禁じる条項は無い (第 11 条。引用は
[`store-survey-2026-09-18.md`](../research/store-survey-2026-09-18.md))。

### アフィリエイト (バリューコマース MyLink)

**最終確認日: 2026-09-24。**

- ポケットドラマCD の提携先として MyLink が許可されていることを、バリューコマースの管理画面で確かめた
- リンクの形の出どころは、管理画面が作品 1 件 (`product_id=101749`) に出したコード
- バリューコマースのヘルプ (<https://help.valuecommerce.ne.jp/aff/ad/adlink/09/>、2026-09-24 取得) は
  広告コードの改変を禁じ、改変にあたらない変更を `target="_blank"` の追加、`rel` の追加・変更、
  `alt` の追加などに限っている。コードには 1x0 の計測画像が `<a>` の中に入っており、
  画像の削除はこの一覧に無いので、画像は消さずに出す

---

## レート間隔

robots.txt に指定が無いので、**こちらの判断**である。
何秒が妥当かは相手にしか分からないため保守的に取った。
声優タグ辞書は一度きりのバッチで、速く終わらせる必要がない。

2026-09-19 の声優タグ辞書の構築時、実測のスループットは設定した間隔とほぼ一致しており、
相手側で絞られてはいない。

---

## 使ってはいけない URL

| 形 | 理由 |
|---|---|
| `/cart/*` | robots が禁止 |
| `/mypage/*` | robots が禁止 |
| `?store=adt` / `?store=adt-bl` (オトナ向け 2 ストア) | robots は禁じていない。**禁止ではなく方針として取得しない**。年齢認証の背後にあり、AniList 対象声優との一致が 0 名で実利がない ([`adult-scope-2026-09-18.md`](../research/adult-scope-2026-09-18.md))。取らなければ Cookie もセッション維持も要らない |
| `list.php?store=adt&age_check=1` + `ECSESSID` Cookie | 同上。年齢認証を通す経路には触れない |
| `/sapi/json.php?query=…&Operation=Suggest&Service=none` | 禁止ではなく**動かない**。JS 内に定義があるが、この引数で叩くと 404 が返る。名前から `tag_id` を引く手段は無い |
| `/tags/` (引数なし) | 404 が返る |
| 商品 sitemap (`sitemap_products_*.xml.gz`) を全件辿る形 | 禁止ではなく**コストが合わない**。商品 URL の数がストアの表示する作品数より 1 桁以上多い (2026-09-18。[`new-release-feeds-2026-09-19.md`](../research/new-release-feeds-2026-09-19.md))。取得コストは sitemap を実際に数えて見積もる |

---

## 既知の落とし穴

- **発売日が存在しない。** 詳細にも新着一覧にも日付の項目が無く、JSON-LD は BreadcrumbList だけ
  (2026-09-21。[`pokedora-new-releases-2026-09-21.md`](../research/pokedora-new-releases-2026-09-21.md))。
  発売日は自由記述としてタイトルに入ることがあるだけで (`《配信開始は2026年11月6日11:00》…` の形)、
  項目としては取れない。sitemap の `lastmod` はページ更新日なので代理にできない。
  新着判定は「初回発見日」の機構に乗る (`docs/product.md` の「新着」) が、
  **1 ストアだけ日付の意味が違う**ことを UI とドキュメントで明示する
- **`list.php` の `disp_number` は `/tags/` と受け付ける値が違う。** `/tags/` の最大値を渡すと
  件数が減る。`list.php` のフォームには `disp_number` の `select` が無い
  (2026-09-21。[`pokedora-disp-number-2026-09-21.md`](../research/pokedora-disp-number-2026-09-21.md))
- **`sitemap_products_*.xml.gz` は毎日は再生成されない。** 2026-09-18 と 2026-09-21 で
  URL 数・`product_id` の範囲・`lastmod` の最大がすべて同じで、その時点の新着が
  入っていなかった。**sitemap の差分を新着検出に使えない**
  ([`pokedora-new-releases-2026-09-21.md`](../research/pokedora-new-releases-2026-09-21.md))
- **新着順 (`order=1`) の並びの基準は一般と BL で違う。** 一般は sitemap の `lastmod` 降順と
  ほぼ一致するが、BL は一致しない。`product_id` の降順とも一致しない。
  ストア側が持つ日付で並んでいるが、その日付は HTML に出ない (2026-09-21。同上)
- **新着一覧にはストア全体の商品が出るので、声優タグ経由では出なかった商品カテゴリが入る。**
  知らない区分は既定に倒れるので、新しい語が出ていないかは取り込んだ区分を見て確かめる
- **一覧と商品詳細のどちらにも出ない項目がある。** 再生時間 (トラック名は出るが尺は出ない)、
  税抜価格 (税込だけが出る)
- **一覧に出る出演声優は 2 名まで。** 表示が打ち切られるだけで、タグの検索自体は全キャストに当たっている
- **タイトル末尾の `【出演声優：…】` と説明欄は主要キャストのみ。** 全員が出るのは「作品情報」欄だけ
- **ページャに `href` が無い。** タグページは無限スクロールで、次ページのリンクが HTML に出ない
- **1 作品に複数商品がある** (通常版・特典版・ダウンロード版)。当面は別作品として扱う。
  確信が無いものをマージしない。商品 sitemap の URL 数が表示上の作品数より多い理由の一部でもある
- **役名の書き方が 4 パターン以上ある。** `役名(CV:声優名)` / `役名 CV:声優名` / `役名:声優名` / 記載なし
- **ストア区分の語彙が 2 系統ある。** パンくず (JSON-LD) は一般を `store=home` と書き、
  ヘッダ検索フォームの `select` は `men` と書く
- **名前から `tag_id` を引く API が無い。** 辞書に無い声優はポケドラを引けない
- **声優タグのリンク文字列はタグ名そのもので、1 タグ 1 表記。** 別名義の根拠にはならない
  (観測は `crawler/.cache/discovery/pokedora-actor-refs.json`)
- **BL が取得対象の過半を占め、BL 件数の多い声優は既存 2 ストアにほぼ現れない**
  ([`pokedora-intersection-2026-09-18.md`](../research/pokedora-intersection-2026-09-18.md))。
  ストア別の全作品数は [`adult-scope-2026-09-18.md`](../research/adult-scope-2026-09-18.md)
- **「DLsite では取れない 851 人」 ([`pokedora-intersection-2026-09-18.md`](../research/pokedora-intersection-2026-09-18.md)) を
  そのまま読まない。** 照合相手が DLsite の全カタログではなく直近サンプルだけだった。
  言えるのは「ポケドラで作品数が多い層は、DLsite の直近全年齢音声にほぼ出ていない」までである。
  Audible は未計測 (空振りした検索はスナップショットが残らないので、スナップショットからは「作品なし」を導けない)

---

## 未確認の項目

- **`order=1` が本当に新着順か。** `select` のラベルはそう読めるが、サイト自身が
  「新規配信順一覧」として `order=2` を指すリンクを置いている
- **新着順 (`order=1`) が何の日付で並べているか。** `lastmod` でも `product_id` でも
  ないことは分かっているが、正体は分からない (「既知の落とし穴」)
- **「NEW」バッジが何日間付くか。** バッジの付いた件数は数えたが、日数に直せない (件数は [`pokedora-new-releases-2026-09-21.md`](../research/pokedora-new-releases-2026-09-21.md))
- **1 ページ目に出ない新商品があるか。** 日次が引く 1 ページ目より深いところは一度も見ていない
  (引く件数は `crawler/adapters/pokedora.ts` の `FEED_DISP_NUMBER`)
- **一覧から商品が消える条件。** 総件数が減った日があり、非公開化か別ストアへの移動かは見ていない (測定は [`pokedora-new-releases-2026-09-21.md`](../research/pokedora-new-releases-2026-09-21.md))
- **無限スクロール (`section.autopager`) が新着一覧にもあるか。** タグページでは使っているが、
  一覧の HTML では見ていない。JS が何を読むかもブラウザを立ち上げていないので分からない
- DLsite との作品の重複。直近サンプルとの照合では 0 件だったが、
  全カタログではないので重複が無いことの証明にはならない
- MyLink の `sid` を変えずに `vc_url` だけを作品ごとに差し替えることが、MyLink が決めるリンク先の指定の
  範囲内かどうか。運営者はそう判断したが、バリューコマースへの照会はしていない

---

## 出典

- [`docs/research/store-survey-2026-09-18.md`](../research/store-survey-2026-09-18.md) —
  robots.txt 全文、sitemap の構成、タグの `tag_type` 内訳、利用規約
- [`docs/research/pokedora-intersection-2026-09-18.md`](../research/pokedora-intersection-2026-09-18.md) —
  タグの全件取得、AniList との交差、一般と BL の件数
- [`docs/research/adult-scope-2026-09-18.md`](../research/adult-scope-2026-09-18.md) —
  4 ストアの件数、年齢認証の仕組み (`ECSESSID`)、オトナ向けの交差 0 名
- [`docs/research/new-release-feeds-2026-09-19.md`](../research/new-release-feeds-2026-09-19.md) —
  sitemap の `lastmod` が新着検出に使えないこと (保存物だけで判断)
- [`docs/research/pokedora-new-releases-2026-09-21.md`](../research/pokedora-new-releases-2026-09-21.md) —
  新着一覧の実測。1 ページの件数、取れる項目、ページ送り、1 日あたりの新作数、
  sitemap が毎日は再生成されないこと
- [`docs/research/pokedora-disp-number-2026-09-21.md`](../research/pokedora-disp-number-2026-09-21.md) —
  `list.php` の `disp_number` が受け付ける値
- `crawler/fixtures/pokedora-list-order1-*.html` — 新着一覧の実 HTML (2026-09-21 取得。`disp_number=100` で 15 件)
- `crawler/adapters/pokedora.ts` のファイル冒頭コメント — 取得手順
