import * as cheerio from "cheerio";
import type { RawWork } from "../../src/domain/index.ts";
import { fetchText } from "../lib/fetch.ts";
import { buildCoverage } from "./coverage.ts";
import { validateRawWorks } from "./raw-work.ts";
import type {
  ActorQuery,
  AdapterResult,
  FetchByActorOptions,
  ParsedWorks,
  SourceAdapter,
} from "./types.ts";

/**
 * Audible Japan のアダプタ。手順は設計書 §3 のとおり:
 *
 * 1. `?searchNarrator={名前}&sort=pubdate-desc-rank` の 1 ページ目 (20 件) だけを取る。
 *    既定 (sort 無し) は人気順 (popularity-rank) で、20 件を超える声優 (例: 石田彰は 38 件)
 *    では新作が 1 ページ目に載らないことがある。`sort=pubdate-desc-rank` を単独で付けると
 *    HTTP 200 のまま発売日降順になる (実測)。`pageSize` や `page` を追加すると
 *    `no-search-results` へ 302 される。robots.txt も `page=` との組み合わせを禁じている
 * 2. `li.productListItem` から 1 件ずつ取り出す
 *
 * `li.productListItem` の中には flyout (popover) があり、同じ情報が短縮形で重複している。
 * flyout 側は「、その他」で省略されるため、必ず本文側のラベル class
 * (`narratorLabel` / `runtimeLabel` / `releaseDateLabel`) を使う
 */

const STORE_SLUG = "audible" as const;
/** Audible は朗読以外の判定をしないので、ストア固有分類は 1 種類だけ (設計書 §4) */
const AUDIBLE_STORE_CATEGORY = "audiobook";

/**
 * 検索の並び順。`pubdate-desc-rank` が新しい順 (既定)、`pubdate-asc-rank` が古い順。
 * 1 ページ目 20 件の制約は `sort` を変えても外れないので、20 件を超える声優は
 * 両方の 1 ページ目を取って和集合にする (40 件まで) (T12)
 */
export type AudibleSearchSort = "pubdate-desc-rank" | "pubdate-asc-rank";

/** 1 ページ目に載る件数の上限 (実測)。`pageSize` や `page` を足すと 302 されるので増やせない */
const PAGE_SIZE = 20;

export function buildSearchUrl(
  narratorName: string,
  sort: AudibleSearchSort = "pubdate-desc-rank",
): string {
  // sort を単独で付けると HTTP 200 のまま発売日順になる (理由は上のコメント参照)
  return `https://www.audible.co.jp/search?searchNarrator=${encodeURIComponent(narratorName)}&sort=${sort}`;
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

/** 「検索結果 38  のうち 1 - 20 件」から総件数 (38) を取る。表示自体が無ければ undefined */
export function parseTotalCount(html: string): number | undefined {
  const matched = /検索結果\s*(\d+)\s*のうち/.exec(html);
  if (matched?.[1] === undefined) return undefined;
  const value = Number(matched[1]);
  return Number.isFinite(value) ? value : undefined;
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
  // 取りこぼしの警告はここでは積まない。並び順違いの 1 ページ目を足した後でないと
  // 網羅率が確定しないため、判断は fetchByActor に集める (T12)
  return totalCount === undefined ? validated : { ...validated, totalCount };
}

/** 選択した要素の文字列を、並び順のまま空文字を除いて集める */
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

  for (const name of names) {
    const result = await fetchText(buildSearchUrl(name), {
      store: STORE_SLUG,
      requestKey: `search-${name}`,
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
          coverage: buildCoverage(0, 0, 1),
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
    const attemptResult = await supplementWithOldest(base, parsed, name, fetchedAt, options);
    if (attemptResult.works.length > 0) return attemptResult;
    // 取得はできたが 0 件。空白なしで先に 200 が返り中身が空、ということは実測では起きていないが、
    // 起きた場合も「まだ確定していない」ものとして次の候補を試す
    attempts.push(attemptResult);
  }

  return pickFallback(base, attempts);
}

/**
 * 総件数が 1 ページ (20 件) を超えるときだけ、古い順の 1 ページ目を 1 回だけ足して
 * 和集合を取る (T12)。新しい順と合わせて 40 件まで覆える。
 *
 * 超えていなければ新しい順の 1 ページ目がその声優の全作品なので、追加のリクエストは出さない。
 * 20 件以下の声優が大半 (実測) なので、無駄打ちを避けるほうが相手サイトへの負荷が軽い
 */
async function supplementWithOldest(
  base: AdapterResult,
  parsed: ParsedWorks,
  name: string,
  fetchedAt: string,
  options: FetchByActorOptions,
): Promise<AdapterResult> {
  const warnings = [...parsed.warnings];
  let invalidCount = parsed.invalidCount;
  let pages = 1;

  // 新しい順を先に入れてあるので、古い順で重複した ASIN は捨てる
  const works = new Map<string, RawWork>();
  for (const work of parsed.works) works.set(work.storeProductId, work);

  if (parsed.works.length > 0 && parsed.totalCount !== undefined && parsed.totalCount > PAGE_SIZE) {
    const oldest = await fetchText(buildSearchUrl(name, "pubdate-asc-rank"), {
      store: STORE_SLUG,
      requestKey: `search-${name}-pubdate-asc`,
      kind: "html",
      snapshot: options.snapshot,
    });
    if (oldest.ok) {
      pages += 1;
      const parsedOldest = parseSearchHtml(oldest.body, fetchedAt);
      invalidCount += parsedOldest.invalidCount;
      warnings.push(...parsedOldest.warnings);
      for (const work of parsedOldest.works) {
        if (!works.has(work.storeProductId)) works.set(work.storeProductId, work);
      }
    } else {
      warnings.push(`古い順での補完に失敗 (${oldest.reason})。新しい順の結果だけで続行`);
    }
  }

  const coverage = buildCoverage(works.size, parsed.totalCount, pages);
  // 並び順 2 通り (最大 40 件) でも総件数に届かない声優。管理画面で気づけるようにする (企画書 §21)
  if (coverage.complete === false) {
    warnings.push(`網羅率 ${coverage.fetched}/${coverage.total}`);
  }

  return {
    ...base,
    works: [...works.values()],
    invalidCount,
    warnings,
    queryUsed: name,
    coverage,
    ...(parsed.totalCount === undefined ? {} : { totalCount: parsed.totalCount }),
  };
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
