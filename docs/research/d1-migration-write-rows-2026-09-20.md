# 本番 D1 への初回移行で書かれる行数 (2026-09-20)

読者: 手元のデータを本番 D1 へ移す人。1 回で流せるかを判断するとき
更新: しない (日付つきの測定。数字を書き換えない)
削除: 参照する文書が無くなったら

手順は `README.md` の「本番 D1」。この測定は `npm run db:export:local` が出す見積もりをそのまま写したもので、
同じコマンドでいつでも取り直せる。

## 測定した条件

- 手元の D1 (Audible を除いた既定の書き出し。除外の理由は README の「本番 D1」)
- 書き込み行数 = 件数 × (1 + その表の索引の本数)。索引の本数は `migrations/*.sql` の
  `CREATE INDEX` と `CREATE UNIQUE INDEX` を数えたもの。D1 は索引への書き込みも 1 日の上限に数える

## 結果

| 表 | 件数 | 索引 | 書き込み行数 |
|---|---:|---:|---:|
| anime_appearances | 16,174 | 3 | 64,696 |
| audio_credits | 12,870 | 2 | 38,610 |
| voice_actor_aliases | 4,954 | 1 | 9,908 |
| store_listings | 3,143 | 2 | 9,429 |
| anime_title_synonyms | 2,421 | 2 | 7,263 |
| audio_works | 3,143 | 1 | 6,286 |
| voice_actors | 2,569 | 1 | 5,138 |
| anime_titles | 1,094 | 2 | 3,282 |
| crawl_runs | 1,385 | 1 | 2,770 |
| **合計** | **47,753** | | **147,382** |

Workers Free プランの 1 日あたりの書き込み行数の上限 (Cloudflare の料金ページの D1 の欄) を
この合計が超えるため、初回の移行は 1 日では流せない。README の手順は 2 日に分けている。

## 2 日への分け方

外部キーの親が先の日に入るように分ける。

| 日 | 表 | 書き込み行数 |
|---|---|---:|
| 1 日目 | voice_actors, voice_actor_aliases, audio_works, store_listings, audio_credits, crawl_runs | 72,141 |
| 2 日目 | anime_titles, anime_title_synonyms, anime_appearances | 75,241 |

`anime_appearances` は `voice_actors` と `anime_titles` を指すので、2 日目に `anime_titles` と同じ日に入れる。
