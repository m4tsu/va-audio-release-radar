import * as cheerio from "cheerio";

/**
 * Wikidata の項目 HTML から、声優のかなに要る事実だけを取り出す純粋関数。
 *
 * ここは fetch も fs も触らない。取得は `wikipedia-kana-refill.ts` が持つ。
 * 項目 JSON (`Special:EntityData`) と SPARQL は robots.txt で禁じられているので、
 * 引けるのは `/wiki/<Q id>` の HTML だけ (`docs/stores/wikimedia.md` の「robots.txt」)。
 * 項目 id は記事 HTML の `wgWikibaseItemId` からしか得られない
 */

/** name in kana。読みを持つプロパティ */
const NAME_IN_KANA = "P1814";

/** 項目の URL。クエリパラメータを付けない (docs/stores/wikimedia.md の「使ってはいけない URL」) */
export function entityUrl(itemId: string): string {
  return `https://www.wikidata.org/wiki/${encodeURIComponent(itemId)}`;
}

/** `Q3546378` の形か。記事から読んだ値をそのまま URL に載せないための確認 */
export function isEntityId(value: string): boolean {
  return /^Q\d+$/.test(value);
}

/**
 * 単独の主張として置かれた P1814 の値を、読んでよい順に返す。
 *
 * **限定子の P1814 は返さない。** P1814 は P1559 (name in native language) や
 * P2562 (married name) の限定子としても付いており、P2562 は結婚後の姓なので
 * 無差別に拾うと別の読みが入る (`docs/research/actor-kana-sources-2026-09-20.md` の「Wikidata」)。
 * 限定子は `.wikibase-statementview-qualifiers` の中の snak として置かれ、
 * `.wikibase-statementview-mainsnak-container` を持たないので、main snak だけを見ることで外れる。
 * 入れ子の深さでは絞らない。主張の並びを包む div が増えても値を取り落とさないため。
 *
 * 順位は Wikibase の意味づけに従う。取り下げられた主張 (`wb-deprecated`) は編集者が
 * 誤りと印を付けたものなので読まず、優先 (`wb-preferred`) が 1 つでもあれば優先だけを読む。
 * 改名した人は旧名の読みも主張として残るので、並び順だけで選ぶと旧名を採ることがある
 */
export function kanaClaims(html: string): string[] {
  const $ = cheerio.load(html);
  const statements = $(`.wikibase-statementgroupview[data-property-id="${NAME_IN_KANA}"]`)
    .find(".wikibase-statementview")
    .toArray()
    .filter((statement) => !$(statement).hasClass("wb-deprecated"));
  const preferred = statements.filter((statement) => $(statement).hasClass("wb-preferred"));
  const values: string[] = [];
  for (const statement of preferred.length > 0 ? preferred : statements) {
    const value = $(statement)
      // 値の無い主張 (somevalue / novalue) は別の variation クラスになるので当たらない
      .find(
        ".wikibase-statementview-mainsnak-container .wikibase-snakview-value.wikibase-snakview-variation-valuesnak",
      )
      .first()
      .text()
      .trim();
    if (value !== "") values.push(value);
  }
  return values;
}
