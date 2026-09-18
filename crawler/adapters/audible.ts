import * as cheerio from "cheerio";
import type { RawWork } from "../../src/domain/index.ts";
import { fetchText } from "../lib/fetch.ts";
import { validateRawWorks } from "./raw-work.ts";
import type { AdapterResult, FetchByActorOptions, ParsedWorks, SourceAdapter } from "./types.ts";

/**
 * Audible Japan のアダプタ。手順は設計書 §3 のとおり:
 *
 * 1. `?searchNarrator={名前}` の 1 ページ目 (20 件) だけを取る。
 *    `pageSize` や `sort` を付けると `no-search-results` へ 302 される。robots.txt も
 *    `page=` / `node=` との組み合わせを禁じている
 * 2. `li.productListItem` から 1 件ずつ取り出す
 *
 * `li.productListItem` の中には flyout (popover) があり、同じ情報が短縮形で重複している。
 * flyout 側は「、その他」で省略されるため、必ず本文側のラベル class
 * (`narratorLabel` / `runtimeLabel` / `releaseDateLabel`) を使う
 */

const STORE_SLUG = "audible" as const;
/** Audible は朗読以外の判定をしないので、ストア固有分類は 1 種類だけ (設計書 §4) */
const AUDIBLE_STORE_CATEGORY = "audiobook";

export function buildSearchUrl(narratorName: string): string {
  return `https://www.audible.co.jp/search?searchNarrator=${encodeURIComponent(narratorName)}`;
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
      adult: false,
      fetchedAt,
    };
    candidates.push(candidate);
  }

  return validateRawWorks(candidates);
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

async function fetchByActor(
  actorName: string,
  options: FetchByActorOptions = {},
): Promise<AdapterResult> {
  const fetchedAt = new Date().toISOString();
  const base = {
    storeSlug: STORE_SLUG,
    actorName,
    status: "ok" as const,
    works: [] as RawWork[],
    invalidCount: 0,
    warnings: [] as string[],
  } satisfies AdapterResult;

  const result = await fetchText(buildSearchUrl(actorName), {
    store: STORE_SLUG,
    requestKey: `search-${actorName}`,
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
      return { ...base, status: "empty", reason: "ナレーター検索に該当なし (no-search-results)" };
    }
    return { ...base, status: "error", reason: `検索ページの取得に失敗: ${result.reason}` };
  }

  const parsed = parseSearchHtml(result.body, fetchedAt);
  return { ...base, ...parsed };
}

export const audibleAdapter: SourceAdapter = {
  storeSlug: STORE_SLUG,
  fetchByActor,
  parseSearchHtml,
};
