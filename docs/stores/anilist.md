# AniList

読者: AniList を引くコードを触る前の人。公開前に利用規約を確かめる人
更新: robots.txt・レート制限・利用規約を取り直したら (差分が無くても最終確認日を更新する)
削除: AniList を対象声優の供給元から外したら

実装: `crawler/anilist.ts` (週次の取り込み) と `crawler/discovery/` の `anilist.ts` / `anilist-payload.ts`。
クエリ・取る項目・値の変換はそこが持つ。共通の原則は [`README.md`](./README.md)。

**ストアではない。** 対象声優の供給元であり、ここから作品は取らない。
対象声優の定義そのものが「AniList にアニメ出演記録がある日本語声優」なので、
AniList が変われば対象集合が変わる。

---

## robots.txt

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
robots.txt 上は制限を受けない。利用の制限は robots.txt ではなく API の利用規約にある
(「既知の落とし穴」)。

---

## レート間隔

**暫定措置であり恒久の値ではない** (理由は下記)。

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
2026-09-19 時点で実際に効いている枠は 30 req/min** (劣化状態がいつ解消されるかは書かれていない)。

### 間隔の決め方

- 根拠は現在の実効上限 30 req/min (上の記載と実測ヘッダの両方、いずれも 2026-09-19)。
  **90 req/min は今の実効値ではない**ので、間隔を詰める根拠にしない
- 30 req/min ちょうどにはせず、閾値が公開されていないバーストリミッターの余地を残して下回らせる
- 劣化状態が解消されて 90 req/min に戻ったことを `x-ratelimit-limit` ヘッダで確認できたら、
  間隔を緩めるかどうかをそのとき改めて判断する
- 超えたときの「1 分間のタイムアウト」が、`Retry-After` の無い 429 で待つ時間の根拠になっている

---

## 使ってはいけない URL

**robots.txt に禁止パスは無い** (「robots.txt」)。URL の形自体を禁じる根拠は無いが、
「既知の落とし穴」の利用規約 (商用利用・保存/再配布の制限、hoarding/mass collection 禁止) は
クエリの中身によらず全体にかかる。現在使っている 2 つのクエリ
(`crawler/discovery/anilist.ts`) 以外を足すときは、robots.txt ではなく利用規約に照らして判断する。

---

## 既知の落とし穴

- **声優のかな表記・別名義の項目は AniList に無い。** 音声作品も扱っていない (アニメのデータベース)。
  かなは日本語版 Wikipedia から取る
  ([`actor-kana-sources-2026-09-20.md`](../research/actor-kana-sources-2026-09-20.md))
- **`characters` は 1 ページ 25 人で、同じ役の中の順序が取得ごとに変わる。**
  1 ページで切ると、同じ条件で取り直しても出演者が入れ替わる
  ([`anilist-cast-instability-2026-09-22.md`](../research/anilist-cast-instability-2026-09-22.md))。
  ページを送って全員取る
- **性別を返さない声優が居る**
  ([`anilist-gender-2026-09-21.md`](../research/anilist-gender-2026-09-21.md))。
  返さないことと「女性でも男性でもない」ことは別なので、同じ値に畳まない。
  「AniList が値を持たない」人は必ず残る
- **アニメでの役の多さと音声作品数はほぼ無相関**。対象声優の大半は音声作品を出していない
  ([`discovery-spike-2026-09-18.md`](../research/discovery-spike-2026-09-18.md))。
  対象の絞り込みに役の多さを使わず、DB には全員入れる
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

  ネーミングガイドライン (同ページより引用):

  > If "AniList" or "AniChart" are used in the title/name of the application, you must
  > clearly state that your app is unofficial by appending either "UNOFFICIAL" or
  > "for AniList"/"for AniChart" to the title/name of the application. Just the
  > titles/names "AniList" and "AniChart" are strictly prohibited

  本プロジェクトは声優と、その声優が出ている作品・演じたキャラクターを**自分の DB に
  恒久的に保存**し、公開する Web サービスで使う予定。事実として言えることと、
  判断が要ることを分けて書く。

  - **事実**: 保存する項目は `crawler/discovery/anilist.ts` の 2 つのクエリが選ぶものに限られる。
    ユーザーデータは取っていない
  - **事実**: それでも対象声優の全員分を通しで取得し DB に持ち続ける挙動は、
    「backup or data storage service として使うのは禁止」「hoarding or mass collection は禁止」
    という文言に触れる余地がある。**該当するかどうかは、原文を読んだだけでは判定できない
    (確認できなかった)**
  - **事実**: 月間売上が $150 を超えなければ commercial license は不要。超えたら
    `contact@anilist.co` に連絡して取得する必要がある
  - **事実**: サービス名 (`src/app/i18n/ja.ts` の `app.name`) は "AniList" / "AniChart" の
    どちらの語も含まないため、naming guidelines には抵触しない
  - **事実**: 今回読んだ Terms of Use には、一般的な「AniList のデータを使っていることを
    クレジット表示せよ」という帰属表示の義務は見当たらなかった (naming guidelines は
    アプリ名に "AniList" を使う場合の話であって、一般的なクレジット要求ではない)
  - **事実**: API キーや事前登録の要否についての記述もこの利用規約には無く、
    実際に無認証の GraphQL リクエストが 200 を返すことも確認済み (2026-09-19、「レート間隔」の実測)

  **公開前に、`contact@anilist.co` へ用途 (声優名・staff id を DB に保存し、
  無料/有料の Web サービスで使う) を説明して可否を確認することを推奨する。**
  このドキュメントの範囲で「問題ない」と判定することはしない。

---

## 未確認の項目

- **バーストリミッターの具体的な閾値** (「burst limiter がある」とだけ書かれており、
  秒あたり何件かという数値はドキュメントに無い)
- **現在の「劣化状態につき 30 req/min」がいつ解消されるか**。ドキュメントは
  「一時的な措置」としか書いておらず期限は無い。解消されたら「レート間隔」の実測を取り直すこと
- **本プロジェクトの保存・再配布のやり方が「hoarding / mass collection」に該当するか
  どうかの AniList 側の判断** (「既知の落とし穴」)。ドキュメントを読むだけでは確定できず、
  `contact@anilist.co` への問い合わせが要る
- シーズン数を増やしたときの対象人数の伸び方
- `Page` の `perPage` の AniList 側の最大値
- 出演者を全ページ引いたときの通しの所要時間 (作品ごとのページ数を全件で数えていない)

---

## 出典

- [`docs/research/anilist-cast-instability-2026-09-22.md`](../research/anilist-cast-instability-2026-09-22.md) —
  同じ条件で取り直しても出演者が入れ替わること、`perPage` の丸め、`total` / `lastPage` の当てにならなさ
- [`docs/research/anilist-gender-2026-09-21.md`](../research/anilist-gender-2026-09-21.md) —
  `Staff.gender` の生の値の内訳と、対象声優に畳んだときの埋まり具合
- [`docs/research/discovery-spike-2026-09-18.md`](../research/discovery-spike-2026-09-18.md) —
  シーズンごとの作品数と声優数、DLsite との交差、役の多さと作品数の相関
- [`docs/research/actor-kana-sources-2026-09-20.md`](../research/actor-kana-sources-2026-09-20.md) — かなの入手元の比較
- [`docs/decisions/0001-target-actors-from-anilist.md`](../decisions/0001-target-actors-from-anilist.md) — 対象声優の定義
- <https://anilist.co/robots.txt> / <https://graphql.anilist.co/robots.txt> — 2026-09-19 確認 (「robots.txt」)
- <https://docs.anilist.co/guide/rate-limiting> — 2026-09-19 確認 (「レート間隔」)
- <https://docs.anilist.co/guide/terms-of-use> — 2026-09-19 確認 (「既知の落とし穴」)
- 実測: `POST https://graphql.anilist.co` に `{ __typename }` を1回送信し
  `x-ratelimit-limit` / `x-ratelimit-remaining` ヘッダを確認 (2026-09-19、「レート間隔」)
