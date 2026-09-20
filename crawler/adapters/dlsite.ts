import * as cheerio from "cheerio";
import { type AgeRating, isAgeRatingAllowed, type RawWork } from "../../src/domain/index.ts";
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
 * DLsite (全年齢サイト = /home/) のアダプタ。手順:
 *
 * 1. 声優名をダブルクォートで囲んだ完全一致検索の 1 ページ目 (既定 30 件) を取る
 * 2. 埋め込み JSON の `pager.count` で総件数を読み、取りこぼしがあるときだけ
 *    古い順の 1 ページ目を足して和集合を取る (最大 60 件)
 * 3. 一覧から ID・タイトル・サークル・サムネイル・種別を取る (一覧に発売日は無い)
 * 4. ID ごとに product.json を 1 件ずつ取り、発売日・声優全員・年齢区分・ジャンルを補う
 * 5. 許可していない年齢区分 (現状は R18) の作品を捨てる
 */

const STORE_SLUG = "dlsite" as const;
/** product.json の `age_category`。1 が全年齢 (`age_category_string: "general"`) */
export const DLSITE_GENERAL_AGE_CATEGORY = 1;
/** 全年齢サイトの `site_id`。R18 サイトは "maniax" になる */
export const DLSITE_HOME_SITE_ID = "home";

/**
 * `age_category` を年齢区分にする。1 だけが全年齢で、2 (R15) も 3 (R18) も
 * まとめて r18 に寄せる。このプロジェクトが区別する必要があるのは「載せるか載せないか」で、
 * 載せない側の内訳を持っても使い道が無いため。
 * 区分そのものが読めなかったときは全年齢と言い切らず unknown にする
 */
export function toAgeRating(ageCategory: number | undefined): AgeRating {
  if (ageCategory === undefined) return "unknown";
  return ageCategory === DLSITE_GENERAL_AGE_CATEGORY ? "general" : "r18";
}

/**
 * 検索の並び順。`release_d` が新しい順 (既定)、`release` が古い順。
 * `per_page` は無視され 1 ページ目の既定件数しか返らないため (実測)、
 * 件数を伸ばす手段は並び順違いの 1 ページ目を足すことしかない
 */
export type DlsiteSearchOrder = "release_d" | "release";

/**
 * 検索 URL。robots.txt が 2 ページ目以降を禁じているので 1 ページ目に固定する。
 * `work_type_category[0]/audio` で音声作品に絞る。
 * 名前をダブルクォートで囲むと完全一致になり、部分一致の別人を拾わない
 */
export function buildSearchUrl(actorName: string, order: DlsiteSearchOrder = "release_d"): string {
  const keyword = encodeURIComponent(`"${actorName}"`);
  return (
    "https://www.dlsite.com/home/fsr/=/language/jp/keyword_creater/" +
    `${keyword}/work_type_category[0]/audio/order/${order}/page/1`
  );
}

export function buildProductJsonUrl(workno: string): string {
  // 複数 workno をカンマ区切りで渡すと空配列が返るため、必ず 1 件ずつ取る
  return `https://www.dlsite.com/home/api/=/product.json?workno=${encodeURIComponent(workno)}`;
}

export function buildProductUrl(workno: string): string {
  return `https://www.dlsite.com/home/work/=/product_id/${workno}.html`;
}

// --- 一覧 HTML の解析 ------------------------------------------------------

/**
 * 検索結果の総件数。一覧 HTML の `<script>` に
 * `window['...'] = {"url":"...","pager":{"have_to_paginate":false,"count":27,...},...}`
 * の形で埋まっているので、そこから `count` を読む (実測)。
 *
 * `pager` オブジェクトの中でキーの並び順は保証されていないため、`{` から最初の `}` までの
 * 範囲 (`[^}]*`) に挟まれた `count` を拾う。ページ内に `"pager"` は 1 か所しか出ない
 * (実測: シード 35 名義すべてで 1 件)。表示が変わって読めなくなったら undefined を返し、
 * 「総件数が分からない」として扱う。網羅率を偽って完全と記録しないため
 */
export function parsePagerCount(html: string): number | undefined {
  const matched = /"pager"\s*:\s*\{[^}]*?"count"\s*:\s*(\d+)/.exec(html);
  if (matched?.[1] === undefined) return undefined;
  const value = Number(matched[1]);
  return Number.isFinite(value) ? value : undefined;
}

export function parseSearchHtml(html: string, fetchedAt: string): ParsedWorks {
  const $ = cheerio.load(html);
  const candidates: unknown[] = [];

  for (const element of $("li[data-list_item_product_id]").toArray()) {
    const item = $(element);
    const workno = item.attr("data-list_item_product_id")?.trim();
    if (workno === undefined || workno === "") continue;

    const titleAnchor = item.find("dd.work_name a[href]").first();
    // title 属性は省略記号の入らない完全なタイトル。無ければリンク文字列で代用する
    const titleRaw = (titleAnchor.attr("title") ?? titleAnchor.text()).trim();
    const makerName = item.find("dd.maker_name > a").first().text().trim();
    // 一覧の声優欄。product.json が取れなかった作品ではこれが creditedNames になる
    const creditedNames = item
      .find("dd.maker_name span.author a")
      .toArray()
      .map((anchor) => $(anchor).text().trim())
      .filter((name) => name !== "");

    const candidate: RawWork = {
      storeSlug: STORE_SLUG,
      storeProductId: workno,
      titleRaw,
      productUrl: httpsUrlOrFallback(titleAnchor.attr("href"), buildProductUrl(workno)),
      coverImageUrl: extractCoverImageUrl(item.html() ?? ""),
      makerName: makerName === "" ? undefined : makerName,
      creditedNames,
      storeCategory: extractWorkType(item.find("div.work_category").attr("class")),
      // /home/ は全年齢サイトなので一覧に R18 は出ない。product.json を取れたら
      // そちらの age_category / site_id で上書きする (applyProductDetail)
      ageRating: "general",
      storeSection: DLSITE_HOME_SITE_ID,
      fetchedAt,
    };
    candidates.push(candidate);
  }

  const validated = validateRawWorks(candidates);
  const totalCount = parsePagerCount(html);
  return totalCount === undefined ? validated : { ...validated, totalCount };
}

/**
 * 一覧の href をそのまま商品 URL にしてよいか。https 以外 (相対 URL、javascript: など) は
 * 使わず、workno から組み立てた正規 URL に落とす。ingest 側でも https 限定で検証している
 */
function httpsUrlOrFallback(href: string | undefined, fallback: string): string {
  const trimmed = href?.trim();
  if (trimmed === undefined || trimmed === "") return fallback;
  try {
    return new URL(trimmed).protocol === "https:" ? trimmed : fallback;
  } catch {
    return fallback;
  }
}

/** `work_category` の class に入っている `type_SOU` から作品種別を取る */
function extractWorkType(className: string | undefined): string | undefined {
  return /\btype_([A-Z]+)\b/.exec(className ?? "")?.[1];
}

/**
 * サムネイル URL。`thumb-with-ng-filter-block` の `:thumb-candidates` は
 * webp と jpg の 240x240 が入った配列リテラルなので、互換性のある jpg を選ぶ。
 * さらに `resize/` の 240x240 版を `modpub/` の原寸版に読み替える。
 * 同じ HTML 内のポップアップ画像がこの URL を使っており、docs/stores/dlsite.md の表紙の規則とも一致する
 */
export function extractCoverImageUrl(itemHtml: string): string | undefined {
  const attribute = /:thumb-candidates="\[([^\]]*)\]"/.exec(itemHtml);
  const inner = attribute?.[1];
  if (inner === undefined) return undefined;
  const urls = [...inner.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? "");
  const picked = urls.find((url) => url.endsWith(".jpg")) ?? urls[0];
  if (picked === undefined || picked === "") return undefined;
  const absolute = picked.startsWith("//") ? `https:${picked}` : picked;
  return absolute.replace("/resize/images2/", "/modpub/images2/").replace(/_\d+x\d+\.jpg$/, ".jpg");
}

// --- product.json の解析 ---------------------------------------------------

export type DlsiteProductDetail = {
  workno: string;
  workName?: string;
  makerName?: string;
  /** `regist_date` ("2026-08-22 00:00:00") の日付部分 */
  releaseDate?: string;
  ageCategory?: number;
  /** "home" (全年齢) / "maniax" (R18)。ストア固有の区分としてそのまま保存する */
  siteId?: string;
  workType?: string;
  voiceNames: string[];
  genres: string[];
};

/** product.json は 1 件だけの配列。想定外の形なら undefined を返し、一覧の情報だけで進める */
export function parseProductJson(text: string): DlsiteProductDetail | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  const record = asRecord(first);
  if (record === undefined) return undefined;

  const workno = asString(record.workno);
  if (workno === undefined) return undefined;

  const creaters = asRecord(record.creaters);
  const voiceBy = Array.isArray(creaters?.voice_by) ? creaters.voice_by : [];
  const genreList = Array.isArray(record.genres) ? record.genres : [];

  return {
    workno,
    voiceNames: collectVoiceNames(voiceBy),
    genres: collectNames(genreList),
    workName: asString(record.work_name),
    makerName: asString(record.maker_name),
    releaseDate: toIsoDate(asString(record.regist_date)),
    ageCategory: asNumber(record.age_category),
    siteId: asString(record.site_id),
    workType: asString(record.work_type),
  };
}

/** `[{ name: "..." }, ...]` から name だけを取り出す */
function collectNames(entries: readonly unknown[]): string[] {
  return entries
    .map((entry) => asString(asRecord(entry)?.name))
    .filter((name): name is string => name !== undefined);
}

/**
 * `creaters.voice_by` から出演者名を取り出す。
 *
 * DLsite は 1 つの `name` に複数人を "上田麗奈|石見舞菜香" のように縦棒で詰めてくることがある。
 * そのまま 1 つの表記として扱うと誰にも名寄せできず、未解決クレジットに積み上がる。
 * 分割して前後の空白を落とし、空になったものは捨てる
 */
function collectVoiceNames(entries: readonly unknown[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const raw of collectNames(entries)) {
    for (const part of raw.split("|")) {
      const name = part.trim();
      if (name === "" || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/** 一覧から作った RawWork に product.json の情報を上書きする。詳細のほうが確度が高い */
export function applyProductDetail(work: RawWork, detail: DlsiteProductDetail): RawWork {
  return {
    ...work,
    // voice_by には出演者全員が入る。一覧の span.author は代表者しか出ないことがある
    creditedNames: detail.voiceNames.length > 0 ? detail.voiceNames : work.creditedNames,
    titleRaw: detail.workName ?? work.titleRaw,
    releaseDate: detail.releaseDate ?? work.releaseDate,
    makerName: detail.makerName ?? work.makerName,
    storeCategory: detail.workType ?? work.storeCategory,
    genres: detail.genres.length > 0 ? detail.genres : work.genres,
    // age_category が読めなければ一覧由来の値 (全年齢) を残す。詳細が取れなかったことを
    // 理由に unknown へ落とすと、一覧の事実まで捨ててしまう
    ageRating: detail.ageCategory === undefined ? work.ageRating : toAgeRating(detail.ageCategory),
    storeSection: detail.siteId ?? work.storeSection,
  };
}

/** "2026-08-22 00:00:00" → "2026-08-22" */
function toIsoDate(value: string | undefined): string | undefined {
  const matched = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return matched === null ? undefined : `${matched[1]}-${matched[2]}-${matched[3]}`;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // product.json は数値を文字列で返す項目があるため許容する
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  return value as Record<string, unknown>;
}

// --- 取得 ------------------------------------------------------------------

async function fetchByActor(
  actor: ActorQuery,
  options: FetchByActorOptions = {},
): Promise<AdapterResult> {
  // DLsite は表記揺れの影響を受けない (空白の有無で結果が変わらない) ので、
  // searchNames の候補は使わず canonicalName の完全一致検索だけを行う
  const actorName = actor.canonicalName;
  const fetchedAt = new Date().toISOString();
  const base = {
    storeSlug: STORE_SLUG,
    actorName,
    status: "ok" as const,
    works: [] as RawWork[],
    invalidCount: 0,
    warnings: [] as string[],
    queryUsed: actorName,
  } satisfies AdapterResult;

  const searchResult = await fetchText(buildSearchUrl(actorName, "release_d"), {
    store: STORE_SLUG,
    requestKey: `search-${actorName}`,
    kind: "html",
    snapshot: options.snapshot,
  });
  if (!searchResult.ok) {
    return { ...base, status: "error", reason: `検索ページの取得に失敗: ${searchResult.reason}` };
  }

  const parsed = parseSearchHtml(searchResult.body, fetchedAt);
  const warnings = [...parsed.warnings];
  let invalidCount = parsed.invalidCount;
  let pages = 1;

  // 並び順違いの和集合を ID で取る。新しい順を先に入れてあるので、古い順で重複したものは捨てる
  const listWorks = new Map<string, RawWork>();
  for (const work of parsed.works) listWorks.set(work.storeProductId, work);

  // 取りこぼしているときだけ古い順の 1 ページ目を足す。これで最大 60 件まで覆える。
  // 総件数に届いているなら追加のリクエストは無駄打ちなので出さない (Crawl-delay 10 秒が効く)
  if (parsed.totalCount !== undefined && listWorks.size < parsed.totalCount) {
    const oldest = await fetchText(buildSearchUrl(actorName, "release"), {
      store: STORE_SLUG,
      requestKey: `search-${actorName}-release-asc`,
      kind: "html",
      snapshot: options.snapshot,
    });
    if (oldest.ok) {
      pages += 1;
      const parsedOldest = parseSearchHtml(oldest.body, fetchedAt);
      invalidCount += parsedOldest.invalidCount;
      warnings.push(...parsedOldest.warnings);
      for (const work of parsedOldest.works) {
        if (!listWorks.has(work.storeProductId)) listWorks.set(work.storeProductId, work);
      }
    } else {
      warnings.push(`古い順での補完に失敗 (${oldest.reason})。新しい順の結果だけで続行`);
    }
  }

  const coverage = buildCoverage(listWorks.size, parsed.totalCount, pages);
  // 並び順 2 通りでも総件数に届かない声優。1 ページ 30 件の上限を超えている合図
  if (coverage.complete === false) {
    warnings.push(`網羅率 ${coverage.fetched}/${coverage.total}`);
  }

  const works: RawWork[] = [];

  for (const listWork of listWorks.values()) {
    if (options.skipKnownIds?.has(listWork.storeProductId) === true) {
      // 既知の作品は詳細を取り直さない。DLsite への往復を減らすため
      works.push(listWork);
      continue;
    }

    const detailResult = await fetchText(buildProductJsonUrl(listWork.storeProductId), {
      store: STORE_SLUG,
      requestKey: `product-${listWork.storeProductId}`,
      kind: "json",
      snapshot: options.snapshot,
    });
    if (!detailResult.ok) {
      warnings.push(
        `${listWork.storeProductId}: product.json の取得に失敗 (${detailResult.reason})。一覧の情報だけで続行`,
      );
      works.push(listWork);
      continue;
    }

    const detail = parseProductJson(detailResult.body);
    if (detail === undefined) {
      warnings.push(
        `${listWork.storeProductId}: product.json を解釈できなかった。一覧の情報だけで続行`,
      );
      works.push(listWork);
      continue;
    }

    const detailed = applyProductDetail(listWork, detail);
    // 許可していない年齢区分は捨てる。判定はドメイン層の許可集合に任せ、
    // ここで「R18 は捨てる」と決め打ちしない
    if (!isAgeRatingAllowed(detailed.ageRating)) {
      warnings.push(
        `${listWork.storeProductId}: 対象外の年齢区分 (age_category=${detail.ageCategory}) のため除外`,
      );
      continue;
    }

    works.push(detailed);
  }

  return {
    ...base,
    works,
    invalidCount,
    warnings,
    coverage,
    ...(coverage.total === undefined ? {} : { totalCount: coverage.total }),
  };
}

export const dlsiteAdapter: SourceAdapter = {
  storeSlug: STORE_SLUG,
  fetchByActor,
  parseSearchHtml,
};
