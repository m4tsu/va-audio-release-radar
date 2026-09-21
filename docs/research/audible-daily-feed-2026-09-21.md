# Audible の日次走行 1 回目の実測 (2026-09-21)

読者: Audible の日次走行の所要や件数を見積もる人
更新: しない。測定した日の事実として固定する
削除: Audible を対応ストアから外したら

`crawler/daily.ts --store audible` を手元の D1 に対して 1 回走らせた記録。
ネットワークは実サイトに出ている。使う URL の robots.txt 上の根拠は
[`docs/stores/audible.md`](../stores/audible.md) の「新着一覧」、
並び順ごとの取り分は [`new-release-feeds-2026-09-19.md`](./new-release-feeds-2026-09-19.md)。

---

## 1. 条件

- 2026-09-21 09:50 UTC 開始。`--no-snapshot`、取り込み先は手元の dev サーバー
- 引いたのは `crawler/adapters/audible.ts` の `AUDIBLE_FEED_URLS` の 8 本 (各 1 ページ 20 件)
- 走行前の `store_listings` の Audible の行は 2,081 件 (声優起点で集めたもの)

## 2. 件数

| | 件数 |
|---|---:|
| 新着枠の総件数 (`検索結果 N のうち`) | 112 |
| 8 本の和集合で取れた作品 | **89** |
| うち DB に無かった作品 | 87 |
| ナレーター名を取れず送らなかった作品 | **25** |
| 取り込みに送った作品 | 62 |
| 取り込みが保存した作品 | 15 |
| 対象声優が 1 人も居ないとして捨てた作品 | 47 |

**8 リクエストで新着枠の 89/112 (79%)。**
[`new-release-feeds-2026-09-19.md`](./new-release-feeds-2026-09-19.md) が 9 リクエストで
測った 76% とほぼ同じで、`price-asc-rank` (取り分 0) を外しても落ちていない。

## 3. ナレーター名を取れない作品は AI 読み上げ

送らなかった 25 件は「ナレーター欄が空」ではない。一覧には
`ナレーター： Virtual Voice` / `ナレーター： デジタルボイス` と出ており、
**人名と違ってリンクになっていない**。実例は
`crawler/fixtures/audible-newreleases-pubdate-desc.html` (6 件すべて Virtual Voice)。

人のナレーターが居ないので、**月次の声優検索 (`searchNarrator=`) でもこの作品は出てこない。**
日次で送らないことによる取りこぼしは無い。

## 4. 所要

**43 秒** (`crawl_runs` の `started_at` 09:50:45 → `finished_at` 09:51:28)。

8 リクエストで、`crawler/lib/fetch.ts` の `rateLimitFor()` が Audible に与える間隔で決まる。
**作品ページを引かないので、取れた件数に関わらずこの 8 往復で一定**である。
DLsite やポケドラは「一覧に出たが DB に無い作品」の詳細を毎日引き直すぶん往復が増えるが
([`dlsite-daily-feed-2026-09-21.md`](./dlsite-daily-feed-2026-09-21.md))、Audible にはそれが無い。

## 5. (推測)

保存率 15/62 はこの 1 回の観測でしかない。走行前の DB が声優起点で集めた 2,081 件しか
持たない状態での値なので、日次を回し続けた後の定常状態とは違う可能性が高い。
