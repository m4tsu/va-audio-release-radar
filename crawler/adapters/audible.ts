import * as cheerio from "cheerio";
import { normalizeName, type RawWork } from "../../src/domain/index.ts";
import { fetchText } from "../lib/fetch.ts";
import { buildCoverage } from "./coverage.ts";
import { validateRawWorks } from "./raw-work.ts";
import type {
  ActorQuery,
  AdapterResult,
  Coverage,
  FetchByActorOptions,
  ParsedWorks,
  SourceAdapter,
} from "./types.ts";

/**
 * Audible Japan のアダプタ。手順は設計書 §3 のとおり:
 *
 * 1. `?searchNarrator={名前}` の 1 ページ目 (20 件) を取る
 * 2. 総件数が 1 ページに収まらないときは `&page=2`、`&page=3` … と順に足して和集合を取る
 * 3. `li.productListItem` から 1 件ずつ取り出す
 *
 * **`sort=` は付けない。** robots.txt (2026-09-19 取得) が禁じているため:
 *
 * ```
 * #Block alternative sort order for /search
 * Disallow: /search*sort=pubdate
 * Disallow: /search*sort=title
 * Disallow: /search*sort=runtime
 * Disallow: /search*sort=review-rank
 *
 * #Block searchAuthor/Narrator/Provider &sort=
 * Disallow: /search?searchNarrator=*&sort=
 * ```
 *
 * 最後の行は `sort` の**値を問わず**、`searchNarrator` との組み合わせそのものを禁じている。
 * 以前ここには並び順を変えた 1 ページ目を足していく実装 (SORT_LADDER) があったが、
 * その 6 種類はすべて禁止対象だった。同日中に取り下げた経緯は決定記録を参照
 * (`docs/design/decisions.md`)。パラメータの順序を入れ替えれば字面の一致は外せるが、
 * コメントに `#Block alternative sort order for /search` と意図が書かれている以上、
 * それは規約の回避であって遵守ではない。
 *
 * 一方、**ページングは許可されている**。`page=` を禁じる規則はどれも別のパラメータとの
 * 組み合わせを条件にしていて、`searchNarrator` + `page` だけの形に一致するものが無い:
 *
 * ```
 * Disallow: /search*title=*page=            ← title= が要る
 * Disallow: /search*keywords=*page=         ← keywords= が要る
 * Disallow: /search*node=*searchNarrator=*page=  ← node= が要る
 * Disallow: /search?advsearchKeywords=*page=
 * Disallow: /*&sort*&page=                  ← sort= が要る
 * ```
 *
 * `li.productListItem` の中には flyout (popover) があり、同じ情報が短縮形で重複している。
 * flyout 側は「、その他」で省略されるため、必ず本文側のラベル class
 * (`narratorLabel` / `runtimeLabel` / `releaseDateLabel`) を使う
 */

const STORE_SLUG = "audible" as const;
/** Audible は朗読以外の判定をしないので、ストア固有分類は 1 種類だけ (設計書 §4) */
const AUDIBLE_STORE_CATEGORY = "audiobook";

/**
 * 1 ページに載る件数 (実測)。`page` を進めるとこの単位でずれる。
 * 斉藤壮馬 (総件数 164) では 1〜8 ページ目が 20 件ずつ、9 ページ目が 4 件だった
 */
const PAGE_SIZE = 20;

/**
 * 1 ページ目の番号。**0 始まりではなく 1 始まり** (2026-09-19 実測)。
 *
 * `/newreleases` の robots.txt には `&page=0` と `&page=2` の Allow があり、
 * `page=1` が抜けている。そこから「0 始まりかもしれない」と読める余地があったので、
 * 検索側を実際に叩いて確かめた。斉藤壮馬の検索結果サマリの表示は次のとおり:
 *
 * - `page` なし … 「検索結果 164 のうち 1 - 20 件」
 * - `&page=1` … 「検索結果 164 のうち 1 - 20 件」(`page` なしと ASIN が完全一致)
 * - `&page=2` … 「検索結果 164 のうち 21 - 40 件」
 * - `&page=9` … 「検索結果 164 のうち 161 - 164 件」
 *
 * つまり `page=N` は `20 * (N - 1) + 1` 件目からで、`page` 省略時は `page=1` と同じ。
 * 1 ページ目は `page` を付けない形で引く (パラメータが少ないほうが正規形に近い)
 */
const FIRST_PAGE = 1;

/**
 * 1 声優あたりに引くページ数の上限。20 件 × 10 ページ = 200 件。
 *
 * 500 人の実測では総件数 20 以下が 380 人、21〜40 が 38 人、41 以上は 9 人しかいないので、
 * ほとんどの声優は 1 ページで終わる。上限を置くのは、`searchNarrator=` が姓だけでも
 * 一致してしまい (LOOSE_MATCH_RATIO のコメント参照) 総件数 355 のような値が返ることがあるため。
 * そこで 18 ページ引いても取れるのは同姓の別人の作品で、相手サイトへの往復が無駄になる。
 * 上限に当たった声優は warnings に残して管理画面で拾う
 */
const MAX_PAGES = 10;

/**
 * 「検索語が広すぎる」と判断する一致率の下限 (T22-D)。
 *
 * `searchNarrator=` は完全一致ではなく姓だけでも拾う。「佐藤 元」で引くと総件数 355 件が返るが、
 * 1 ページ目のナレーターは佐藤恵・佐藤詩乃・佐藤弘樹・佐藤佑暉・佐藤慧・佐藤正宏で、
 * **佐藤元は 1 件も含まれない** (2026-09-19 実測)。この 355 はその声優の作品数ではないので、
 * 網羅率の分母に使えない。
 *
 * 一方、正しく引けている声優では一致率がほぼ 1 になる (斉藤壮馬は全 164 件中 1 件を除いて本人名義。
 * 残り 1 件は本人の冠番組でナレーター欄が空)。0 に近い側と 1 に近い側がはっきり分かれるので、
 * その間に線を引く。ナレーター欄が空の作品がたまたま固まっても落ちない程度に低く取る
 */
const LOOSE_MATCH_RATIO = 0.2;

/**
 * 検索 URL。1 ページ目は `page` を付けず、2 ページ目以降だけ `&page=N` を足す。
 *
 * `sort=` は付けない (robots.txt が禁じている。理由はファイル冒頭のコメント参照)。
 * 並びは既定の人気順のままだが、ページングで全ページを辿るので網羅率は落ちない。
 * むしろ斉藤壮馬 (164 件) で 164/164 と、並び順のはしごの 84/164 より上がった
 */
export function buildSearchUrl(narratorName: string, page: number = FIRST_PAGE): string {
  const base = `https://www.audible.co.jp/search?searchNarrator=${encodeURIComponent(narratorName)}`;
  // page=1 は page なしと同じ結果 (ASIN まで一致) なので、1 ページ目は素の URL にする
  return page <= FIRST_PAGE ? base : `${base}&page=${page}`;
}

/**
 * 商品 URL は正規形 (`/pd/{ASIN}`) を組み立てる。一覧の href は `/pd/{slug}/{ASIN}` の形で
 * スラッグ部分がタイトル変更で変わりうるため、そちらは使わない (設計書 §3)
 */
export function buildProductUrl(asin: string): string {
  return `https://www.audible.co.jp/pd/${asin}`;
}

/** 「ナレーター検索に該当なし」のときに飛ばされる先 (設計書 §3) */
const NO_SEARCH_RESULTS_PATH = "/no-search-results";

/** 302 の Location が該当なしページかどうか。相対 URL で来ることがあるので絶対化して見る */
export function isNoSearchResultsLocation(location: string | undefined): boolean {
  if (location === undefined) return false;
  try {
    return new URL(location, "https://www.audible.co.jp").pathname === NO_SEARCH_RESULTS_PATH;
  } catch {
    return false;
  }
}

// --- 一覧 HTML の解析 ------------------------------------------------------

/**
 * 検索結果サマリから総件数を取る。表示自体が無ければ undefined。
 *
 * 表記は 2 通りある (2026-09-19 実測):
 * - 2 件以上 … 「検索結果 164  のうち 1 - 20 件」
 * - ちょうど 1 件 … 「検索結果 1 件」。`のうち` が出ない
 *
 * 500 人のクロールで総件数を読めなかった 73 件は**すべて取得 1 件**で、この後者の表記だった。
 * `のうち` だけを見ていたので取り逃していた (T22-C)。
 * 桁区切りのカンマは実測では出ていないが、4 桁以上で出たときに黙って落ちないよう許容する
 */
const TOTAL_COUNT_PATTERNS = [/検索結果\s*([\d,]+)\s*のうち/, /検索結果\s*([\d,]+)\s*件/] as const;

export function parseTotalCount(html: string): number | undefined {
  for (const pattern of TOTAL_COUNT_PATTERNS) {
    const matched = pattern.exec(html)?.[1];
    if (matched === undefined) continue;
    const value = Number(matched.replace(/,/g, ""));
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

export function parseSearchHtml(html: string, fetchedAt: string): ParsedWorks {
  const $ = cheerio.load(html);
  const candidates: unknown[] = [];

  for (const element of $("li.productListItem").toArray()) {
    const item = $(element);
    const asin = /^product-list-item-(.+)$/.exec(item.attr("id") ?? "")?.[1];
    if (asin === undefined || asin === "") continue;

    // 本文側の見出しは h3、flyout 側は h2 なので h3 を見れば重複を避けられる
    const titleFromHeading = item.find("h3 a").first().text().trim();
    const titleRaw =
      titleFromHeading === "" ? (item.attr("aria-label")?.trim() ?? "") : titleFromHeading;

    // flyout 側の li には narratorLabel / authorLabel の class が無いので、本文側だけが拾える
    const narrators = textsOf($, item.find("li.narratorLabel a"));
    const authors = textsOf($, item.find("li.authorLabel a"));
    // subtitle には出版社が「（小学館）」の形で入る。無ければ著者を発売元の代わりに使う
    const publisher = stripParentheses(item.find("li.subtitle span").first().text().trim());

    const candidate: RawWork = {
      storeSlug: STORE_SLUG,
      storeProductId: asin,
      titleRaw,
      productUrl: buildProductUrl(asin),
      coverImageUrl: item.find("img.bc-image-inset-border").first().attr("src")?.trim(),
      releaseDate: toIsoDate(item.find("li.releaseDateLabel").first().text()),
      durationSeconds: parseRuntimeSeconds(item.find("li.runtimeLabel").first().text()),
      price: parsePrice(item.find(".buybox-regular-price").first().text()),
      makerName: publisher !== "" ? publisher : (authors[0] ?? undefined),
      // ナレーター名は「上田 麗奈」のように空白入りのまま入れる。表記の寄せは名寄せ側の責務
      creditedNames: narrators,
      storeCategory: AUDIBLE_STORE_CATEGORY,
      // Audible は年齢区分を公開していないので「全年齢」とは言い切れない。
      // unknown にしておき、表示側は R18 を除く形で絞る (設計書 §14)
      ageRating: "unknown",
      fetchedAt,
    };
    candidates.push(candidate);
  }

  const validated = validateRawWorks(candidates);
  const totalCount = parseTotalCount(html);
  // 取りこぼしの警告はここでは積まない。2 ページ目以降を足した後でないと
  // 網羅率が確定しないため、判断は fetchByActor に集める (T12)
  return totalCount === undefined ? validated : { ...validated, totalCount };
}

/** 選択した要素の文字列を、出現順のまま空文字を除いて集める */
function textsOf($: cheerio.CheerioAPI, nodes: ReturnType<cheerio.CheerioAPI>): string[] {
  return nodes
    .map((_index, node) => $(node).text().trim())
    .get()
    .filter((text) => text !== "");
}

/** 「（小学館）」→「小学館」。全角・半角どちらの括弧でも外す */
function stripParentheses(text: string): string {
  return text
    .replace(/^[(（]/, "")
    .replace(/[)）]$/, "")
    .trim();
}

/** 「配信日： 2024/06/28」→ "2024-06-28" */
export function toIsoDate(text: string): string | undefined {
  const matched = /(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(text);
  if (matched === null) return undefined;
  const [, year, month, day] = matched;
  if (year === undefined || month === undefined || day === undefined) return undefined;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** 「再生時間： 9 時間  6 分」→ 32760。時間だけ・分だけの表記も通す */
export function parseRuntimeSeconds(text: string): number | undefined {
  const hours = Number(/(\d+)\s*時間/.exec(text)?.[1] ?? "0");
  const minutes = Number(/(\d+)\s*分/.exec(text)?.[1] ?? "0");
  const total = hours * 3600 + minutes * 60;
  // 「再生時間」欄そのものが無い場合は 0 になるので、値なしとして返す
  return total > 0 ? total : undefined;
}

/** 「￥2,690 で購入、または…」→ 2690。聴き放題のみの作品は価格表示が無く undefined */
export function parsePrice(text: string): number | undefined {
  const matched = /[￥¥]\s*([\d,]+)/.exec(text);
  if (matched?.[1] === undefined) return undefined;
  const value = Number(matched[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : undefined;
}

// --- 取得 ------------------------------------------------------------------

/**
 * Audible は名前によって空白の有無で結果が変わる (実測: 「石見舞菜香」は空白なしだと
 * `no-search-results` へ 302、空白ありの「石見 舞菜香」だと 2 件返る。上田麗奈は両方 7 件)。
 * `actor.searchNames` を先頭から順に試し、1 件以上の結果 (`status: "ok"`) が返った時点で確定する。
 * 個々の候補が `error` になっても他の候補は試す。全滅したときだけ全体を `error` にする (T8)
 */
async function fetchByActor(
  actor: ActorQuery,
  options: FetchByActorOptions = {},
): Promise<AdapterResult> {
  const fetchedAt = new Date().toISOString();
  const base = {
    storeSlug: STORE_SLUG,
    actorName: actor.canonicalName,
    status: "ok" as const,
    works: [] as RawWork[],
    invalidCount: 0,
    warnings: [] as string[],
  } satisfies AdapterResult;

  // searchNames が空のときは canonicalName だけで検索する (呼び出し側の作り忘れに対する保険)
  const names = actor.searchNames.length > 0 ? actor.searchNames : [actor.canonicalName];
  const attempts: AdapterResult[] = [];

  // 本人名義かどうかの照合に使う名前。検索に使った候補だけでなく canonicalName も入れる。
  // 検索は「斉藤 壮馬」で通っても、作品側の表記が「齊藤壮馬」ということがあるため
  // (normalizeName が異体字と空白を畳む)
  const actorNames = new Set(
    [actor.canonicalName, ...actor.searchNames].map(normalizeName).filter((name) => name !== ""),
  );

  for (const name of names) {
    const result = await fetchText(buildSearchUrl(name, FIRST_PAGE), {
      store: STORE_SLUG,
      requestKey: `search-${name}-p${FIRST_PAGE}`,
      kind: "html",
      snapshot: options.snapshot,
    });

    if (!result.ok) {
      // 2026-09-18 の実測: 存在しない名前でも `/no-search-results` へ 302 され、その直後に
      // 別の名前を投げると 200 が返る。つまりこの 302 は「ナレーター検索に該当なし」であって
      // アクセス制限ではない。よって失敗ではなく empty (成功・0 件) として返す (設計書 §3)。
      // 取り込み側は 0 件でも既存の listing / credit を消さないので、将来ここに制限が混ざっても
      // データが失われることはない。件数の急減は管理画面の警告で拾う
      if (isNoSearchResultsLocation(result.location)) {
        attempts.push({
          ...base,
          status: "empty",
          queryUsed: name,
          coverage: { ...buildCoverage(0, 0, 1), matched: 0 },
          reason: "ナレーター検索に該当なし (no-search-results)",
        });
        continue;
      }
      attempts.push({
        ...base,
        status: "error",
        queryUsed: name,
        reason: `検索ページの取得に失敗: ${result.reason}`,
      });
      continue;
    }

    const parsed = parseSearchHtml(result.body, fetchedAt);
    const attemptResult = await collectAcrossPages(
      base,
      parsed,
      { name, actorNames },
      fetchedAt,
      options,
    );
    if (attemptResult.works.length > 0) return attemptResult;
    // 取得はできたが 0 件。空白なしで先に 200 が返り中身が空、ということは実測では起きていないが、
    // 起きた場合も「まだ確定していない」ものとして次の候補を試す
    attempts.push(attemptResult);
  }

  return pickFallback(base, attempts);
}

/**
 * 2 ページ目以降を順に足していき、ASIN の和集合を作る (T25)。
 *
 * 総件数に応じて必要な分だけ引き、それ以上は引かない。500 人の実測では総件数 20 以下が 380 人、
 * 21〜40 が 38 人、41 以上は 9 人しかいないので、ほとんどの声優ではリクエストが 1 回のまま増えない。
 *
 * 打ち切りの条件は次の 4 つ:
 * - 和集合が総件数に達した … もう取るものが無い
 * - 直前のページが 20 件に満たなかった … 最後のページだったので続きが無い
 * - MAX_PAGES に達した … 上限 (理由は MAX_PAGES のコメント)
 * - 取得に失敗した … 相手が答えられない状態で残りを投げ続けない。そこまでの結果で続行する
 */
async function collectAcrossPages(
  base: AdapterResult,
  first: ParsedWorks,
  query: { name: string; actorNames: ReadonlySet<string> },
  fetchedAt: string,
  options: FetchByActorOptions,
): Promise<AdapterResult> {
  const { name, actorNames } = query;
  const warnings = [...first.warnings];
  let invalidCount = first.invalidCount;
  let total = first.totalCount;
  let pages = 1;

  // 先に取ったページを優先して入れるので、後のページで重複した ASIN は捨てる
  const works = new Map<string, RawWork>();
  for (const work of first.works) works.set(work.storeProductId, work);

  // そのページが埋まっていたか (= 続きがあるか) の判定は、検証で捨てた分も数に入れる。
  // 検証落ちを引くと「20 件未満だから最後のページだ」と誤って判断してしまうため
  let lastPageItemCount = first.works.length + first.invalidCount;

  for (let page = FIRST_PAGE + 1; page <= MAX_PAGES; page += 1) {
    if (!needsMorePages(works.size, total, lastPageItemCount)) break;

    const next = await fetchText(buildSearchUrl(name, page), {
      store: STORE_SLUG,
      requestKey: `search-${name}-p${page}`,
      kind: "html",
      snapshot: options.snapshot,
    });
    if (!next.ok) {
      warnings.push(`${page} ページ目の取得に失敗 (${next.reason})。ここまでの結果で続行`);
      break;
    }

    pages += 1;
    const parsed = parseSearchHtml(next.body, fetchedAt);
    invalidCount += parsed.invalidCount;
    warnings.push(...parsed.warnings);
    // 1 ページ目で総件数を読めなくても、後のページで読めればそこから拾う
    total ??= parsed.totalCount;
    lastPageItemCount = parsed.works.length + parsed.invalidCount;

    // ページングなので本来ページ間で重複は出ない (斉藤壮馬の 9 ページ 164 件で重複 0 を実測)。
    // 出たとすれば取得中に並びが動いた合図で、ずれた分だけ取りこぼしている可能性がある。
    // 黙って畳むと気づけないので件数を残す
    let duplicated = 0;
    for (const work of parsed.works) {
      if (works.has(work.storeProductId)) duplicated += 1;
      else works.set(work.storeProductId, work);
    }
    if (duplicated > 0) {
      warnings.push(`${page} ページ目に既出の作品が ${duplicated} 件 (取得中に並びが動いた可能性)`);
    }
  }

  // 総件数の表示を読めないまま最後に引いたページが埋まらなかった = そこが最終ページ =
  // 見えた分がその声優の全作品。ここまで言えるので「不明」にせず全件扱いにする (T22-C)
  if (total === undefined && lastPageItemCount < PAGE_SIZE) total = works.size;

  const coverage = judgeCoverage([...works.values()], { total, pages, actorNames }, (warning) =>
    warnings.push(warning),
  );
  // ページ数の上限で打ち切った声優。総件数が信用できないとき (coverage.total が落ちたとき) は
  // 「200 件まで」と言っても分母が無いので鳴らさない
  if (coverage.complete === false && pages >= MAX_PAGES) {
    warnings.push(
      `${coverage.total} 件中 ${coverage.fetched} 件まで取得 (1 声優あたり ${MAX_PAGES} ページが上限)`,
    );
  }

  return {
    ...base,
    works: [...works.values()],
    invalidCount,
    warnings,
    queryUsed: name,
    coverage,
    // 総件数は coverage と揃える。信用できないと判断したものを別の欄に残すと、
    // 後から読んだ人がそちらを分母に使ってしまう
    ...(coverage.total === undefined ? {} : { totalCount: coverage.total }),
  };
}

/**
 * 網羅率を決め、必要な警告を積む (T22-D)。
 *
 * `searchNarrator=` が姓だけでも一致してしまうので、**総件数をそのまま分母にはできない**。
 * 取得した作品のうち本人がクレジットされている割合を測り、極端に低ければ
 * 「その総件数は同姓の別人を含む」とみなして `total` ごと落とし、網羅率を不明にする。
 *
 * `complete: false` (取りこぼしあり) にしないのは、それが「取り逃した作品がある」という
 * 別の主張になるため。佐藤元の 355 件に対して 20 件しか取れていなくても、取り逃しているのは
 * 佐藤元の作品ではなく同姓の別人の作品なので、それを取りこぼしとして報告し続けても意味がない。
 * 分母が分からない以上、言えるのは「判断できない」だけ
 */
function judgeCoverage(
  works: readonly RawWork[],
  context: { total: number | undefined; pages: number; actorNames: ReadonlySet<string> },
  warn: (warning: string) => void,
): Coverage {
  const { total, pages, actorNames } = context;
  const matched = countCreditedWorks(works, actorNames);
  const looseMatch = works.length > 0 && matched / works.length < LOOSE_MATCH_RATIO;

  if (looseMatch) {
    const totalNote =
      total === undefined ? "" : `。総件数 ${total} は同姓の別人を含むとみて網羅率は不明とする`;
    warn(`検索語が広すぎる可能性 (本人名義 ${matched}/${works.length} 件)${totalNote}`);
  }

  const coverage: Coverage = {
    ...buildCoverage(works.length, looseMatch ? undefined : total, pages),
    matched,
  };
  // 全ページを辿っても総件数に届かない声優。管理画面で気づけるようにする (企画書 §21)。
  // 一致率が低いときは complete 自体が undefined になるので、ここは鳴らない
  if (coverage.complete === false) {
    warn(`網羅率 ${coverage.fetched}/${coverage.total}`);
  }
  return coverage;
}

/**
 * 検索した声優本人がクレジットされている作品数。
 *
 * 判定はナレーター欄 (`creditedNames`) だけで行い、タイトルは見ない。
 * 「斉藤壮馬の本心」のように本人名がタイトルに入る番組があり、そこまで数えると
 * 「本人の作品が並んでいる」ことの根拠として弱くなるため
 */
function countCreditedWorks(works: readonly RawWork[], actorNames: ReadonlySet<string>): number {
  let matched = 0;
  for (const work of works) {
    if (work.creditedNames.some((credited) => actorNames.has(normalizeName(credited)))) {
      matched += 1;
    }
  }
  return matched;
}

/**
 * まだ次のページを引く価値があるか。
 *
 * まず直前のページが 20 件に満たなければ、そこが最終ページなので必ず止める。
 * これは総件数の表示に頼らず「実際に返ってきた件数」だけで言えるので、
 * 総件数が読めているかどうかにかかわらず先に見る。
 *
 * そのうえで、総件数が読めていれば「和集合が総件数に届いていない」ことを条件にする。
 * 総件数 20 以下の声優は実測で 500 人中 380 人いて、そこは 1 リクエストのまま変わらない。
 * 総件数を読めなかったときは、ページが埋まっている限り最善努力で辿る
 */
function needsMorePages(
  fetched: number,
  total: number | undefined,
  lastPageItemCount: number,
): boolean {
  // 1 件も取れていないなら次のページにも無い (該当なしか、解析が壊れている)
  if (fetched === 0) return false;
  // 埋まっていないページの次は空。実測でも 9 ページ目 (4 件) が最後だった
  if (lastPageItemCount < PAGE_SIZE) return false;
  if (total === undefined) return true;
  // 総件数が 1 ページに収まる = 2 ページ目が無い。取得件数が総件数に足りていなくても
  // (解析落ちなど) 次のページには何も無いので引かない
  if (total <= PAGE_SIZE) return false;
  return fetched < total;
}

/**
 * 全候補が「1 件以上の ok」にならなかったときの確定結果を選ぶ。
 * - `ok` (0 件) があれば最後に取得できたものを使う (取得自体は成功しているため)
 * - なければ `empty` を優先する。1 つでも `no-search-results` が確認できれば、他の候補が
 *   `error` でも「作品が無い」と判断できる (石見舞菜香: 空白なし→302、空白あり→2件 のように
 *   候補ごとに結果が割れるため、`empty` を `error` より弱いとは見なさない)
 * - 全滅 (すべて `error`) のときだけ `error` を返す
 */
function pickFallback(base: AdapterResult, attempts: readonly AdapterResult[]): AdapterResult {
  const lastOk = [...attempts].reverse().find((attempt) => attempt.status === "ok");
  if (lastOk !== undefined) return lastOk;
  const firstEmpty = attempts.find((attempt) => attempt.status === "empty");
  if (firstEmpty !== undefined) return firstEmpty;
  return attempts[attempts.length - 1] ?? { ...base, status: "error", reason: "検索候補が 0 件" };
}

export const audibleAdapter: SourceAdapter = {
  storeSlug: STORE_SLUG,
  fetchByActor,
  parseSearchHtml,
};
