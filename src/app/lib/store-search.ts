import type { StoreSlug } from "@/domain/types";

/** 検索語を決めるのに要る分だけ。`ActorDetail` がそのまま渡せる形にしてある */
export type SearchableActor = {
  canonicalName: string;
  aliases: readonly { name: string; verified: boolean }[];
};

/**
 * ストアでその声優の作品を検索する URL。人が押して開く導線で、クローラーは使わない。
 *
 * `crawler/adapters/*.ts` の `buildSearchUrl` を使い回さないのは、依存の向きが
 * `src/app → src/server → src/domain` で crawler を import できないため
 * (`docs/architecture.md` の「依存方向」)。あちらは取得のための URL (並び順・ページ指定つき) で、
 * こちらは人が開く 1 枚目なので形も同じにならない。
 *
 * 検索語は日本語の表記から選ぶ。DLsite も Audible も日本語のストアで、
 * 表示言語が英語でもローマ字表記では引けない。
 *
 * 返せないストアがある (ポケドラ)。返せないときは `undefined`
 */
export function storeActorSearchUrl(
  storeSlug: StoreSlug,
  actor: SearchableActor,
): string | undefined {
  switch (storeSlug) {
    case "dlsite": {
      // 作者名での検索。名前をダブルクォートで囲むと完全一致になり、部分一致の別人を拾わない。
      // 表記揺れの影響を受けないので canonicalName で引く (`docs/stores/dlsite.md` の「一覧と検索」)。
      // フロアは全年齢の同人 (`/home/`) を指す。商業の女性向け (`/garumani/`) はこの結果に出ないが、
      // DLsite の検索結果に他フロアへの切り替えリンクがある (同ファイルの「フロア」)
      const keyword = encodeURIComponent(`"${actor.canonicalName}"`);
      return (
        `https://www.dlsite.com/home/fsr/=/language/jp/keyword_creater/` +
        `${keyword}/work_type_category[0]/audio`
      );
    }
    case "audible":
      // ナレーター検索。著者名やタイトルに名前が含まれるだけの別作品を拾わない
      return `https://www.audible.co.jp/search?searchNarrator=${encodeURIComponent(audibleSearchName(actor))}`;
    case "pokedora":
      // ポケドラの声優一覧はストア内の `tag_id` でしか開けず、名前から `tag_id` を引く手段が
      // ストアに無い (`docs/stores/pokedora.md` の「使ってはいけない URL」)。
      // `tag_id` は DB にも入れていないので、この声優のページへ送る URL を組み立てられない
      return undefined;
  }
}

/**
 * Audible に渡す名前。
 *
 * ナレーター検索は空白の有無で結果が変わり、姓名を詰めた表記では 0 件になる声優がいる。
 * 検証済みの空白入り別名があればそれを使う (`docs/stores/audible.md` の「既知の落とし穴」)。
 * クローラーも同じ順で試すので、注記を出した走行が見たのと同じ結果に送れる
 */
function audibleSearchName(actor: SearchableActor): string {
  const spaced = actor.aliases.find((alias) => alias.verified && /\s/.test(alias.name));
  return spaced?.name ?? actor.canonicalName;
}
