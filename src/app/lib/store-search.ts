import type { StoreSlug } from "@/domain/types";

/**
 * ストアでその声優の作品を検索する URL。人が押して開く導線で、クローラーは使わない。
 *
 * `crawler/adapters/*.ts` の `buildSearchUrl` を使い回さないのは、依存の向きが
 * `src/app → src/server → src/domain` で crawler を import できないため
 * (`docs/architecture.md` の「依存方向」)。あちらは取得のための URL (並び順・ページ指定つき) で、
 * こちらは人が開く 1 枚目なので形も同じにならない。
 *
 * 検索語は `canonicalName` を渡す。DLsite も Audible も日本語のストアで、
 * 表示言語が英語でもローマ字表記では引けないため。
 *
 * 返せないストアがある (ポケドラ)。返せないときは `undefined`
 */
export function storeActorSearchUrl(storeSlug: StoreSlug, actorName: string): string | undefined {
  switch (storeSlug) {
    case "dlsite":
      // 作者名での検索。名前をダブルクォートで囲むと完全一致になり、部分一致の別人を拾わない。
      // フロアは全年齢総合 (`/home/`) だけを指す。クローラーは `/garumani/` も引くが、
      // 人が開くのは 1 枚で足りるので、作品数の多い方に送る
      return (
        `https://www.dlsite.com/home/fsr/=/language/jp/keyword_creater/` +
        `${encodeURIComponent(`"${actorName}"`)}/work_type_category[0]/audio`
      );
    case "audible":
      // ナレーター検索。著者名やタイトルに名前が含まれるだけの別作品を拾わない
      return `https://www.audible.co.jp/search?searchNarrator=${encodeURIComponent(actorName)}`;
    case "pokedora":
      // ポケドラの声優一覧はストア内の `tag_id` でしか開けず、名前から `tag_id` を引く手段が
      // ストアに無い (`docs/stores/pokedora.md` の「使ってはいけない URL」)。
      // `tag_id` は DB にも入れていないので、この声優のページへ送る URL を組み立てられない
      return undefined;
  }
}
