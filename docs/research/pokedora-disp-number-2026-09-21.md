# ポケドラの `list.php` で `disp_number` は効く (2026-09-21)

読者: ポケドラの一覧を引くコードを書く人。1 ページの件数を決めたい人
更新: しない (日付つきの測定。数字を書き換えない)
削除: 参照する文書が無くなったら

[`pokedora-new-releases-2026-09-21.md`](./pokedora-new-releases-2026-09-21.md) は
「`list.php` では `disp_number` が効かない。1 ページ 15 件で固定される」と結論していた。
そこで試したのは `disp_number=100` の 1 通りだけで、**値を変えると件数が変わる**ことを
確かめていなかった。値を変えて引き直した記録。

外部へのリクエストは **3 件**。すべて `pokedora.com`。`crawler/lib/fetch.ts` の `fetchText` を通した。
DB には書き込んでいない。

## 測定

`https://pokedora.com/products/list.php?mode=search&name=&xfp=0&genre_tag_id=0&order=1&store=men&pageno=1`
に `disp_number` だけを足して引いた。

| `disp_number` | `li.product_list_el` の数 | `div.search_count` |
|---|---:|---|
| 指定なし | **30** | `1,365件中　1 - 30件目` |
| `30` | **30** | `1,365件中　1 - 30件目` |
| `100` | **15** | `1,365件中　1 - 15件目` |

総件数はどれも 1,365 件で同じ。表示件数だけが変わっている。

## 読めること

- **`disp_number` は `list.php` でも効く。** 変わらないのではなく、`100` が受け付けられず
  小さい値に落ちている
- **`100` を渡すと 15 件になる。** 指定なし (30 件) より少ない。`/tags/` は 30 / 50 / 100 を
  選べるが、`list.php` のフォームには `disp_number` の `select` が無く、受け付ける値の集合が違う
- **(推測)** `15` は `list.php` の最小値かフォールバックで、未知の値を渡すとここに落ちる。
  `50` は試していない
- 前の測定が出した「最終ページ 91 = ceil(1365 ÷ 15)」は `disp_number=100` を付けた条件での値で、
  条件が変われば変わる

## 実装への影響

日次の走行は `disp_number=30` を明示して引く (`crawler/adapters/pokedora.ts` の `buildFeedUrl`)。
省いても今は 30 件だが、既定が変われば新着を覆う窓が黙って狭くなるため。
