# AniList

読者: AniList を引くコードを触る前の人。公開前に利用規約を確かめる人
更新: robots.txt・レート制限・利用規約を取り直したら (差分が無くても最終確認日を更新する)
削除: AniList を対象声優の供給元から外したら

実装: `crawler/anilist.ts` (週次の取り込み) と `crawler/discovery/` の `anilist.ts` / `anilist-payload.ts`
共通の原則は [`README.md`](./README.md)。

**ストアではない。** 対象声優の供給元であり、ここから作品は取らない。
対象声優の定義そのものが「AniList にアニメ出演記録がある日本語声優」なので、
AniList が変われば対象集合が変わる。

---

## 1. robots.txt

**最終確認日: 2026-09-19。**

`anilist.co` と `graphql.anilist.co` は**同一の robots.txt** を返す
(`curl -I` で両方取得し、`Content-Length: 71`、`ETag: "69c9b605-47"`、
`Last-Modified: Sun, 29 Mar 2026 23:30:13 GMT` が完全一致することを確認)。全文:

```
User-agent: *
Disallow:

Sitemap: https://anilist.co/sitemap/index.xml
```

`Disallow:` が空なので**禁止パスは無い**。`Crawl-delay` の指定も無い。
`graphql.anilist.co` への POST (このプロジェクトが使っている唯一のアクセス方法) も、
robots.txt 上は制限を受けない。

---

## 2. レート間隔

> **実装の値は `crawler/lib/fetch.ts` の `rateLimitFor()` が持つ。食い違ったらコードが正。**
> この節は、なぜその値なのかを書く場所であって、値を複製する場所ではない。

キーは `anilist`。**暫定措置であり恒久の値ではない** (理由は下記)。

### 公式ドキュメントの記載 (原文引用。[`docs.anilist.co/guide/rate-limiting`](https://docs.anilist.co/guide/rate-limiting)、2026-09-19 確認)

> WARNING
> The API is currently in a degraded state and is limited to 30 requests per minute.
> This is a temporary measure until the API is fully restored.

> The AniList API has a rate limit of 90 requests per minute.

> When you make a request to the AniList API, you will recieve `X-RateLimit-Limit` and
> `X-RateLimit-Remaining` headers in the response. [...] If you exceed the rate limit, you
> will recieve a 1 minute timeout. Any further requests in this timeout period will also
> include the `Retry-After` and `X-RateLimit-Reset` headers in the response. `Retry-After`
> is the number of seconds you should wait before making another request. `X-RateLimit-Reset`
> contains the Unix timestamp of when you can make another request.

> Burst Limiting
> On top of the above rate limiting, we also have a burst limiter. This limiter is designed
> to stop you from hammering the API with too many requests in a very short period of time.

(`recieve` は原文ママの誤記。) バーストリミッターの具体的な閾値 (秒あたり何件か) は
ドキュメントに数値の記載が無く、**未確認**。

### 実測 (2026-09-19、`POST https://graphql.anilist.co` に `{ __typename }` を1回だけ送信)

```
HTTP/2 200
x-ratelimit-limit: 30
x-ratelimit-remaining: 29
```

公式ドキュメントの「現在は劣化状態で 30 req/min」と一致した。**90 req/min は平常時の値であり、
このドキュメントを書いている時点で実際に効いている枠は 30 req/min**
(劣化状態がいつ解消されるかは書かれていない)。

### 旧 1.5 秒 (40 req/min) の判定と、3.0 秒への変更

**緩すぎた。制限を超えていた。** 1.5 秒 = 40 req/min は、これまで根拠にしていた
公称 90 req/min に対しては半分以下だったが、**今実際に効いている 30 req/min を上回っていた**。
このままだと定常的に 429 を踏む計算になる。`fetch.ts` は 429 を検出して `Retry-After` の
秒数だけ待ち直す実装になっているので壊れて止まりはしないが、429 を前提にした運用になる。

**採用: 3.0 秒間隔 (20 req/min)。** 30 req/min ちょうど (2.0 秒間隔) ではなく、
閾値が公開されていないバーストリミッターの余地を残すため、上限の 2/3 まで落とした。
根拠は現在の実効上限 30 req/min (docs.anilist.co/guide/rate-limiting の記載と、実測ヘッダ
`x-ratelimit-limit: 30` の両方で確認、いずれも 2026-09-19)。**90 req/min は平常時の値であって
今の実効値ではない**ので、間隔を決める根拠にしていない。劣化状態が解消されて
90 req/min に戻ったことを `x-ratelimit-limit` ヘッダで確認できたら、間隔を緩めるかどうかを
そのとき改めて判断する (暫定措置であり恒久の値ではない)。

`Retry-After` が無い 429 のときに 60 秒待つ実装 (`DEFAULT_RATE_LIMITED_DELAY_MS`) は、
公式ドキュメントの「1 分間のタイムアウト」という記述と整合している。

---

## 3. 使う URL

```
POST https://graphql.anilist.co
Content-Type: application/json
```

**認証は不要。** クエリは 2 種類だけ。性別も出演者と一緒にこの 2 つで取る。

### シーズンのアニメと出演声優 (`SEASON_PAGE_QUERY`)

```graphql
query ($season: MediaSeason, $seasonYear: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { currentPage lastPage hasNextPage total }
    media(type: ANIME, season: $season, seasonYear: $seasonYear,
          sort: POPULARITY_DESC, isAdult: false) {
      id
      title { native romaji english }
      synonyms
      format
      popularity
      startDate { year month day }
      endDate { year month day }
      coverImage { large color }
      characters(page: 1, perPage: 25, sort: ROLE) {
        pageInfo { hasNextPage }
        edges {
          role
          node { id name { native full } image { medium } }
          voiceActors(language: JAPANESE) { id name { native full } image { medium } gender }
        }
      }
    }
  }
}
```

対象シーズンは実行日から決める。次のシーズンを新しい端にして、そこから 12 個
(`crawler/discovery/anilist.ts` の `recentSeasons`)。固定の年は書かない。

`characters` は 1 ページ目だけが返る。`pageInfo.hasNextPage` が立っている作品は
下の `MEDIA_CHARACTERS_QUERY` で続きを引き、**出演者を上限で切らない**。

### 1 作品ぶんの出演者の続き (`MEDIA_CHARACTERS_QUERY`)

```graphql
query ($id: Int, $page: Int) {
  Media(id: $id, type: ANIME) {
    id
    characters(page: $page, perPage: 25, sort: ROLE) {
      pageInfo { hasNextPage }
      edges {
        role
        node { id name { native full } image { medium } }
        voiceActors(language: JAPANESE) { id name { native full } image { medium } gender }
      }
    }
  }
}
```

---

## 4. 使ってはいけない URL

**robots.txt に禁止パスは無い** (§1)。URL の形自体を禁じる根拠は無いが、
§6 の利用規約 (商用利用・保存/再配布の制限、hoarding/mass collection 禁止) は
クエリの中身によらず全体にかかる。現在使っている 2 つのクエリ以外を足すときは、
robots.txt ではなく §6 の利用規約に照らして判断する。

- `isAdult: false` を外さない。成人向けアニメを対象集合に入れない
- `characters(perPage: ...)` に 25 より大きい値を書いても意味が無い。AniList が 25 に丸める
  (2026-09-22 の実測、[`anilist-cast-instability-2026-09-22.md`](../research/anilist-cast-instability-2026-09-22.md))。
  全員を取るには `hasNextPage` が下りるまでページを送る

---

## 5. 取得できる項目 / できない項目

| 項目 | 可否 | GraphQL のキー |
|---|:--:|---|
| staff id | ○ | `voiceActors.id` → `VoiceActor.anilistStaffId` |
| 日本語表記の名前 | ○ | `name.native` → `canonicalName`。**ストアとの突き合わせに使う唯一の鍵** |
| ローマ字表記 | ○ | `name.full` ("Reina Ueda") → `slug` の元、英語表示に出す名前 |
| 声優の画像 | ○ | `image.medium` |
| 性別 | ○ | `gender`。**自由記述の文字列で、利用者が編集できる。** 実応答は `Female` / `Male` / `Non-binary` / null の 4 通りだった (2026-09-21、[`docs/research/anilist-gender-2026-09-21.md`](../research/anilist-gender-2026-09-21.md))。そのまま保存せず列挙に写す。出演者と一緒に返る |
| 作品 (アニメ) | ○ | `media.id` / `title.{native,romaji,english}` / `coverImage.large` |
| 表紙の代表色 | ○ | `coverImage.color` ("#e4a128") |
| 別名タイトル | ○ | `synonyms`。**空配列のことがある** (2026-09-20 の実応答で、上位 3 件中 1 件) |
| 形式 | ○ | `format` (`TV` / `MOVIE` / `OVA` / `ONA` など) |
| 人気度 | ○ | `popularity` (整数)。一覧の既定の並びに使う |
| 放送開始日 / 終了日 | ○ | `startDate` / `endDate`。**`FuzzyDate` なので year / month / day が個別に null になりうる**。放送前の作品の終了日は 3 つとも null (2026-09-20 の実応答で確認) |
| キャラクターと役 | ○ | `characters.edges[].node` / `.role` |
| **かな表記** | **×** | 日本語版 Wikipedia から取り、台帳の付加情報に出どころ付きで入れる |
| **別名義** | **×** | 検証済みのものだけを台帳の別名義の表に入れる |
| 音声作品 | × | AniList はアニメのデータベースであり、音声作品は扱っていない |

`title.english` は **null のことが実際にある** (2026-09-18 の実応答で確認)。

---

## 6. 既知の落とし穴

- **`node { id }` を外すと `voiceActors` が null になる。** キャラクターの `node` を
  取らないクエリにすると声優が返ってこない。消さないこと
- **同じ `nativeName` を複数の staff id が持つことがある。** 台帳からは落とさない
  (staff id が鍵なので別人として持てる)。ストアのクレジット表記からどちらの作品かを断定できない
  問題は、照合が「複数の声優に当たったら unmatched」で断っている (`src/domain/identity.ts`)
- **`characters` は 1 ページ 25 人で、同じ役の中の順序が取得ごとに変わる。**
  25 人で切ると、同じ条件で取り直しても毎回 100 人規模の出演者が入れ替わる
  (2026-09-22 の測定で、1 ページに収まらない 309 作品のうち 281 作品で中身が変わった。
  [`anilist-cast-instability-2026-09-22.md`](../research/anilist-cast-instability-2026-09-22.md))。
  ページを送って全員取ること
- **`characters` の `total` と `lastPage` は最後のページに着くまで実際と違う値を返す。**
  続きの有無は `hasNextPage` だけで判定する (同じ測定ノート)
- **slug が衝突したら生成を失敗させる。** 自動で連番を振らない。
  後から来た人の slug に staff id を付ける (`src/domain/actor-slug.ts`)。slug は URL に出て後から変えられない
- **ワープロ式のローマ字表記をそのまま使う。** `Akari Kitou` → `kitou-akari`、
  `Aoi Yuuki` → `yuuki-aoi`。長音を潰して `kito` / `yuki` に寄せない。
  「ou」「uu」が長音とは限らず (井上 = Inoue、松浦 = Matsuura)、潰すと別の名前を壊す。
  本人の公表表記と食い違う人 (日笠陽子 = `Youko Hikasa`) は台帳の付加情報に出どころ「編集」で入れて直す
- **`name.full` に改行や二重空白が混じっていることがある** ("Makoto\r\n Takahashi"、
  2026-09-18 に取得した応答の 2,567 件中 12 件)。英語表示に出す前に空白を詰める
- **1 語の名義**「ゆかな」「麦人」「KENN」はその語をそのまま slug にする。
  除外すると実在の声優が丸ごと落ちる
- **3 語以上**「ブリドカット・セーラ・恵美」= Sarah Emi Bridcutt は最後の語を姓、
  残りを名として前から並べる
- **性別を返さない声優が居る** (2026-09-21 の実測で対象 2,512 人中 162 人)。
  返さないことと「女性でも男性でもない」ことは別なので、同じ値に畳まない。
  **「AniList が値を持たない」人は必ず残る**。取り込みは今回言われた項目だけを上書きするので、
  値を持たない声優の性別は「不明」のまま動かない
- **`roleCount` (アニメでの役の多さ) と音声作品数はほぼ無相関** (スピアマン −0.047)。
  主役級ほど音声作品が多い、ということはない。対象の絞り込みに役の多さを使わない
- 対象声優の大半は音声作品を出していない。DB には全員入れる
- **API の利用規約 (`docs.anilist.co/guide/terms-of-use`、2026-09-19 確認) に、
  データの保存・再配布と商用利用についての制限がある。** 原文引用:

  > Free for non-commercial usage. See our commercial usage section for more.
  > Using the AniList API as a backup or data storage service is strictly prohibited.
  > Hoarding or mass collection of data from the AniList API is strictly prohibited.
  > Applications or services must comply with our naming guidelines.
  > Use of the AniList API within competing, non-complementary services of the same nature
  > is prohibited. This includes, but is not limited to, anime and manga list or tracker
  > services. The restriction applies to all data provided through the API, including both
  > user data and media data.

  商用利用の条件 (同ページより引用):

  > The AniList API may be used within commercial applications or services operating at less
  > than $150 of revenue per month free of charge, no express permission is required.
  > Applications or services operating at greater than $150 of revenue per month will need to
  > acquire a commercial license.

  ナレーミングガイドライン (同ページより引用):

  > If "AniList" or "AniChart" are used in the title/name of the application, you must
  > clearly state that your app is unofficial by appending either "UNOFFICIAL" or
  > "for AniList"/"for AniChart" to the title/name of the application. Just the
  > titles/names "AniList" and "AniChart" are strictly prohibited

  本プロジェクトは声優と、その声優が出ている作品・演じたキャラクターを**自分の DB に
  恒久的に保存**し、公開する Web サービスで使う予定。事実として言えることと、
  判断が要ることを分けて書く。

  - **事実**: 保存しているのは声優 (staff id・名前・画像 URL)、対象声優が出ている作品
    (media id・タイトル・シーズン・形式・人気度・放送日・別名・表紙の URL と代表色)、
    その声優が演じたキャラクター (character id・名前・画像 URL)。
    あらすじ・話数・ジャンル・タグ・制作スタッフ・評価は取っていない。
    ユーザーデータは一切取っていない
  - **事実**: それでも対象声優の全員分を通しで取得し DB に持ち続ける挙動は、
    「backup or data storage service として使うのは禁止」「hoarding or mass collection は禁止」
    という文言に触れる余地がある。**該当するかどうかは、原文を読んだだけでは判定できない
    (確認できなかった)**
  - **事実**: 月間売上が $150 を超えなければ commercial license は不要。超えたら
    `contact@anilist.co` に連絡して取得する必要がある
  - **事実**: アプリ名・サービス名に "AniList" / "AniChart" を使わなければ naming
    guidelines には抵触しない。サービス名 `Koenect` (`src/app/i18n/ja.ts` の `app.name`) は
    どちらの語も含まないため、naming guidelines には抵触しない
  - **事実**: 今回読んだ Terms of Use には、一般的な「AniList のデータを使っていることを
    クレジット表示せよ」という帰属表示の義務は見当たらなかった (naming guidelines は
    アプリ名に "AniList" を使う場合の話であって、一般的なクレジット要求ではない)
  - **事実**: API キーや事前登録の要否についての記述もこの利用規約には無く、
    実際に無認証の GraphQL リクエストが 200 を返すことも確認済み (§3 に既述)

  **公開前に、`contact@anilist.co` へ用途 (声優名・staff id を DB に保存し、
  無料/有料の Web サービスで使う) を説明して可否を確認することを推奨する。**
  このドキュメントの範囲で「問題ない」と判定することはしない。

---

## 7. 未確認の項目

- **バーストリミッターの具体的な閾値** (「burst limiter がある」とだけ書かれており、
  秒あたり何件かという数値はドキュメントに無い)
- **現在の「劣化状態につき 30 req/min」がいつ解消されるか**。ドキュメントは
  「一時的な措置」としか書いておらず期限は無い。解消されたら §2 の実測を取り直すこと
- **本プロジェクトの保存・再配布のやり方が「hoarding / mass collection」に該当するか
  どうかの AniList 側の判断** (§6)。ドキュメントを読むだけでは確定できず、
  `contact@anilist.co` への問い合わせが要る
- シーズンを 12 から増やしたときの対象人数の伸び方
- `Page(perPage: 50)` の上限が 50 で正しいか (AniList 側の最大値を確認していない)
- 出演者を全ページ引いたときの通しの所要時間 (作品ごとのページ数を全件で数えていない)

---

## 8. 出典

- [`docs/research/anilist-cast-instability-2026-09-22.md`](../research/anilist-cast-instability-2026-09-22.md) —
  同じ条件で取り直しても出演者が入れ替わること、`perPage` の丸め、`total` / `lastPage` の当てにならなさ
- [`docs/research/anilist-gender-2026-09-21.md`](../research/anilist-gender-2026-09-21.md) —
  `Staff.gender` の生の値の内訳と、対象声優に畳んだときの埋まり具合
- [`docs/research/discovery-spike-2026-09-18.md`](../research/discovery-spike-2026-09-18.md) —
  12 シーズン 1,176 作品から 2,569 人、DLsite との交差 57 人、`roleCount` の無相関、
  AniList へのリクエストは通し実行で 24 件
- [`docs/decisions/0001-target-actors-from-anilist.md`](../decisions/0001-target-actors-from-anilist.md) — 対象声優の定義
- `crawler/discovery/actor-entity.ts` — slug の生成規則と除外条件
- <https://anilist.co/robots.txt> / <https://graphql.anilist.co/robots.txt> — 2026-09-19 確認 (§1)
- <https://docs.anilist.co/guide/rate-limiting> — 2026-09-19 確認 (§2)
- <https://docs.anilist.co/guide/terms-of-use> — 2026-09-19 確認 (§6)
- 実測: `POST https://graphql.anilist.co` に `{ __typename }` を1回送信し
  `x-ratelimit-limit` / `x-ratelimit-remaining` ヘッダを確認 (2026-09-19、§2)
