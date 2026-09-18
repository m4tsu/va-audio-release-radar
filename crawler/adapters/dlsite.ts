import * as cheerio from "cheerio";
import type { RawWork } from "../../src/domain/index.ts";
import { fetchText } from "../lib/fetch.ts";
import { validateRawWorks } from "./raw-work.ts";
import type { AdapterResult, FetchByActorOptions, ParsedWorks, SourceAdapter } from "./types.ts";

/**
 * DLsite (全年齢サイト = /home/) のアダプタ。手順は設計書 §3 のとおり:
 *
 * 1. 声優名をダブルクォートで囲んだ完全一致検索の 1 ページ目 (既定 30 件) を取る
 * 2. 一覧から ID・タイトル・サークル・価格・定価・サムネイル・種別を取る (一覧に発売日は無い)
 * 3. ID ごとに product.json を 1 件ずつ取り、発売日・声優全員・年齢区分・ジャンルを補う
 * 4. `age_category !== 1` (全年齢以外) の作品を捨てる
 */

const STORE_SLUG = "dlsite" as const;
/** product.json の `age_category`。1 が全年齢 (`age_category_string: "general"`) */
export const DLSITE_GENERAL_AGE_CATEGORY = 1;

/**
 * 検索 URL。robots.txt が `per_page` 付きと 2 ページ目以降を禁じているので 1 ページ目に固定する。
 * `order/release_d` で新着順、`work_type_category[0]/audio` で音声作品に絞る。
 * 名前をダブルクォートで囲むと完全一致になり、部分一致の別人を拾わない
 */
export function buildSearchUrl(actorName: string): string {
  const keyword = encodeURIComponent(`"${actorName}"`);
  return (
    "https://www.dlsite.com/home/fsr/=/language/jp/keyword_creater/" +
    `${keyword}/work_type_category[0]/audio/order/release_d/page/1`
  );
}

export function buildProductJsonUrl(workno: string): string {
  // 複数 workno をカンマ区切りで渡すと空配列が返るため、必ず 1 件ずつ取る (設計書 §3)
  return `https://www.dlsite.com/home/api/=/product.json?workno=${encodeURIComponent(workno)}`;
}

export function buildProductUrl(workno: string): string {
  return `https://www.dlsite.com/home/work/=/product_id/${workno}.html`;
}

// --- 一覧 HTML の解析 ------------------------------------------------------

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
      // .strike (定価) は .work_price の兄弟要素なので、配下を辿れば現在価格だけが取れる
      price: parseJapaneseNumber(
        item.find("dd.work_price_wrap > .work_price .work_price_base").first().text(),
      ),
      listPrice: parseJapaneseNumber(
        item.find("dd.work_price_wrap > .strike .work_price_base").first().text(),
      ),
      makerName: makerName === "" ? undefined : makerName,
      creditedNames,
      storeCategory: extractWorkType(item.find("div.work_category").attr("class")),
      adult: false, // /home/ は全年齢サイトなので一覧に成人向けは出ない
      fetchedAt,
    };
    candidates.push(candidate);
  }

  return validateRawWorks(candidates);
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

/** `1,584` のような表記を数値にする。空文字や数字を含まない文字列は undefined */
function parseJapaneseNumber(text: string): number | undefined {
  const digits = text.replace(/\D/g, "");
  if (digits === "") return undefined;
  const value = Number(digits);
  return Number.isFinite(value) ? value : undefined;
}

/** `work_category` の class に入っている `type_SOU` から作品種別を取る */
function extractWorkType(className: string | undefined): string | undefined {
  return /\btype_([A-Z]+)\b/.exec(className ?? "")?.[1];
}

/**
 * サムネイル URL。`thumb-with-ng-filter-block` の `:thumb-candidates` は
 * webp と jpg の 240x240 が入った配列リテラルなので、互換性のある jpg を選ぶ。
 * さらに `resize/` の 240x240 版を `modpub/` の原寸版に読み替える。
 * 同じ HTML 内のポップアップ画像がこの URL を使っており、設計書 §3 の画像 URL 規則とも一致する
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
  workType?: string;
  price?: number;
  officialPrice?: number;
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
    workType: asString(record.work_type),
    price: asNumber(record.price),
    officialPrice: asNumber(record.official_price),
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
    price: detail.price ?? work.price,
    listPrice: detail.officialPrice ?? work.listPrice,
    genres: detail.genres.length > 0 ? detail.genres : work.genres,
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

  const searchResult = await fetchText(buildSearchUrl(actorName), {
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
  const works: RawWork[] = [];

  for (const listWork of parsed.works) {
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

    // 全年齢だけを扱う (設計書 §1)。区分が取れた作品のうち 1 以外は捨てる
    if (detail.ageCategory !== undefined && detail.ageCategory !== DLSITE_GENERAL_AGE_CATEGORY) {
      warnings.push(
        `${listWork.storeProductId}: 全年齢ではない (age_category=${detail.ageCategory}) ため除外`,
      );
      continue;
    }

    works.push(applyProductDetail(listWork, detail));
  }

  return { ...base, works, invalidCount: parsed.invalidCount, warnings };
}

export const dlsiteAdapter: SourceAdapter = {
  storeSlug: STORE_SLUG,
  fetchByActor,
  parseSearchHtml,
};
