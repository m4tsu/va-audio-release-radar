import * as cheerio from "cheerio";
import { isAgeRatingAllowed, type RawWork } from "../../src/domain/index.ts";
import { fetchText } from "../lib/fetch.ts";
import { buildCoverage } from "./coverage.ts";
import { validateRawWorks } from "./raw-work.ts";
import type {
  ActorQuery,
  AdapterResult,
  FetchByActorOptions,
  ObservedActorRef,
  ParsedWorks,
  SourceAdapter,
  StoreActorRef,
} from "./types.ts";

/**
 * ポケットドラマ CD (pokedora.com) のアダプタ。手順:
 *
 * 1. 声優タグのページを引く (`/tags/?tag_type=1&tag_id={id}&disp_number=100&store={men|bl}`)。
 *    tag_id は事前に作った辞書 (`crawler/pokedora-tags.generated.json`) から
 *    `crawler/run.ts` が渡す。辞書に無い声優はこのストアを引かない
 * 2. 一覧から作品 ID・タイトル・商品カテゴリを取る
 * 3. 作品ごとに詳細ページを引き、出演声優の全員とレーベルを補う
 *
 * 他ストアと違うところ:
 *
 * - **検索ではなくタグで引く**。ポケドラでは声優がタグという一級の概念で、
 *   `a[href*="tag_type=1"]` から声優の tag_id まで取れる (表記揺れに依存しない)
 * - **発売日が存在しない**。詳細にも一覧にも日付が無く、JSON-LD は BreadcrumbList だけ、
 *   sitemap の `lastmod` はページ更新日なので代理にできない。`releaseDate` は undefined のまま送り、
 *   「発売日が無い作品は初回発見日で新着判定する」機構に乗せる
 * - **役名は取らない**。`役名(CV:声優名)` / `役名 CV:声優名` / `役名:声優名` / 記載なし と
 *   4 パターン以上に割れており、単一の正規表現では抽出できない (ストア横断調査 §1)
 * - **取るのは一般 (men) と BL (bl) だけ**。オトナ向け 2 ストア (adt / adt-bl) は
 *   年齢認証の背後にあり、AniList 対象声優との一致が 0 名で実利がない。
 *   したがって `ageRating` は常に "general" で、BL かどうかは `storeSection` に残す
 */

const STORE_SLUG = "pokedora" as const;

/** 取得対象のストア区分。adt / adt-bl は取らない */
export const POKEDORA_SECTIONS = ["men", "bl"] as const;
export type PokedoraSection = (typeof POKEDORA_SECTIONS)[number];

/** 声優を表す tag_type。1=声優 / 2=シリーズ / 3=レーベル / 4=原作者等 (調査済み) */
const VOICE_ACTOR_TAG_TYPE = 1;
/** レーベルの tag_type。makerName に入れる */
const LABEL_TAG_TYPE = 3;
/** 関連ワードの tag_type。ジャンル相当として genres に入れる */
const KEYWORD_TAG_TYPE = 4;

/** 1 ページの表示件数。ポケドラが選択肢として持っている最大値 */
export const DISP_NUMBER = 100;
/**
 * 1 つの (tag_id, ストア区分) で引くページ数の上限。
 * 実測の最大は 1 人 148 件 (古川慎) なので 2 ページで足りるが、
 * 総件数の読み取りが壊れたときに延々とページを繰らないための歯止めとして置く
 */
const MAX_PAGES = 20;

// --- URL -------------------------------------------------------------------

export function buildTagPageUrl(tagId: number, section: PokedoraSection, pageno = 1): string {
  // robots.txt が禁じているのは /cart/* と /mypage/* だけで、pageno は禁じられていない。
  // disp_number を最大にして往復を減らす (5 秒間隔なので 1 往復の価値が大きい)
  return (
    `https://pokedora.com/tags/?tag_type=${VOICE_ACTOR_TAG_TYPE}&tag_id=${tagId}` +
    `&disp_number=${DISP_NUMBER}&store=${section}&pageno=${pageno}`
  );
}

export function buildProductUrl(productId: string): string {
  return `https://pokedora.com/products/detail.php?product_id=${encodeURIComponent(productId)}`;
}

/** カバー画像。og:image と同じ URL を ID から組み立てられる */
export function buildCoverImageUrl(productId: string): string {
  return `https://pokedora.com/get_image.php?product_id=${encodeURIComponent(productId)}&thumb=large`;
}

// --- タグページ (一覧) の解析 ----------------------------------------------

/**
 * 「小林千晃に関する作品(66件)」から総件数を取る。
 *
 * 同じ `h2.heading_primary` は「人気検索ワード」にも使われているので、
 * 「に関する作品」まで見てから件数を読む。表示が変わって読めなければ undefined を返し、
 * 「総件数が分からない」として扱う (網羅率を偽って完全と記録しないため)
 */
export function parseTagTotalCount(html: string): number | undefined {
  const matched = /に関する作品\s*[(（]\s*(\d+)\s*件/.exec(html);
  if (matched?.[1] === undefined) return undefined;
  const value = Number(matched[1]);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * 今表示しているストア区分。タブの `active` が付いたリンクの `data-store` から取る。
 * 一覧 HTML だけで区分が決まるので、解析側に区分を引数で渡さなくて済む
 */
export function parseActiveSection(html: string): PokedoraSection | undefined {
  const $ = cheerio.load(html);
  const value = $("a.category_tab_el_link.active").first().attr("data-store");
  return isPokedoraSection(value) ? value : undefined;
}

function isPokedoraSection(value: string | undefined): value is PokedoraSection {
  return value !== undefined && (POKEDORA_SECTIONS as readonly string[]).includes(value);
}

/**
 * タグページ 1 枚を解析する (`SourceAdapter.parseSearchHtml`)。
 *
 * 一覧だけで作品 ID・タイトル・商品カテゴリ・表紙が揃うので、既知の作品では
 * ここで作った `RawWork` をそのまま使い、詳細取得を飛ばせる (`--skip-known`)。
 * 一覧には出演声優が出ないので `creditedNames` は空になる。ingest は credit を
 * 消さずに残すので、既知の作品の出演者が消えることはない
 */
export function parseSearchHtml(html: string, fetchedAt: string): ParsedWorks {
  const $ = cheerio.load(html);
  const section = parseActiveSection(html);
  const candidates: unknown[] = [];

  for (const element of $("li.product_list_el").toArray()) {
    const item = $(element);
    const href = item.find('a[href*="product_id="]').first().attr("href");
    const productId = extractProductId(href);
    if (productId === undefined) continue;

    const titleAnchor = item.find("p.product_title a").first();
    // title 属性は省略記号の入らない完全なタイトル。無ければリンク文字列で代用する
    const titleRaw = normalizeSpace(titleAnchor.attr("title") ?? titleAnchor.text());
    const categories = item
      .find("span.product_catgory_el")
      .toArray()
      .map((el) => normalizeSpace($(el).text()))
      .filter((value) => value !== "");

    const candidate: RawWork = {
      storeSlug: STORE_SLUG,
      storeProductId: productId,
      titleRaw,
      productUrl: buildProductUrl(productId),
      coverImageUrl: buildCoverImageUrl(productId),
      // 一覧には出演声優が出ない。詳細で埋める (applyProductDetail)
      creditedNames: [],
      ...(categories[0] === undefined ? {} : { storeCategory: categories[0] }),
      ...(categories.length === 0 ? {} : { genres: categories }),
      // 一般と BL しか引かないので、一覧に出た時点で全年齢扱いでよい
      ageRating: "general",
      ...(section === undefined ? {} : { storeSection: section }),
      fetchedAt,
    };
    candidates.push(candidate);
  }

  const validated = validateRawWorks(candidates);
  const totalCount = parseTagTotalCount(html);
  return totalCount === undefined ? validated : { ...validated, totalCount };
}

/** `/products/detail.php?product_id=139137` から ID を取る。相対 URL で来る */
function extractProductId(href: string | undefined): string | undefined {
  const matched = /[?&]product_id=(\d+)/.exec(href ?? "");
  return matched?.[1];
}

/**
 * 半角の空白・改行の連続を 1 つに畳んで前後を落とす。
 * 全角空白 (U+3000) は畳まない。日本語のタイトルでは字面の一部なので、
 * 詰めると一覧と詳細で別のタイトルになってしまう
 */
function normalizeSpace(value: string): string {
  return value.replace(/[ \t\r\n]+/g, " ").trim();
}

// --- 作品詳細の解析 --------------------------------------------------------

/** 出演声優 1 人。tag_id は「同じ tag_id なら同一人物」というストア由来の事実 */
export type PokedoraCredit = { name: string; tagId: number };

export type PokedoraProductDetail = {
  title?: string;
  /** レーベル (tag_type=3)。サークル / 出版社に相当する */
  makerName?: string;
  credits: PokedoraCredit[];
  section?: PokedoraSection;
  coverImageUrl?: string;
  /** 商品カテゴリの先頭 ("一般ドラマCD" / "BLCD" / "シチュエーションCD") */
  storeCategory?: string;
  /** 商品カテゴリ全部 + 関連ワード (tag_type=4) */
  genres: string[];
};

/** 作品情報欄のリンク 1 本。href から tag_id を読むので、文字列と一緒に持つ */
type TagLink = { name: string; href: string };

/**
 * 作品詳細ページを解析する。
 *
 * 出演声優は **「作品情報」欄 (`div.item_detail_extra`) からしか全員は取れない**。
 * タイトル末尾の `【出演声優：…】` は主要キャストだけで、17 名の作品でも 6 名しか出ない。
 * 上部の `div.item_detail_info_desc` は同じ全員が出ることもあるが、
 * 主要キャストに切られている作品があるので、作品情報欄が取れなかったときの予備にとどめる
 */
export function parseProductDetail(html: string): PokedoraProductDetail {
  const $ = cheerio.load(html);

  const extraCredits = extraTagLinks($, "出演声優", VOICE_ACTOR_TAG_TYPE);
  const credits = toCredits(
    extraCredits.length > 0 ? extraCredits : descTagLinks($, "出演声優", VOICE_ACTOR_TAG_TYPE),
  );

  const categories = $("span.product_catgory_el")
    .map((_, element) => normalizeSpace($(element).text()))
    .get()
    .filter((text) => text !== "");
  const keywords = extraTagLinks($, "関連ワード", KEYWORD_TAG_TYPE).map((link) => link.name);

  const title = normalizeSpace($("h1.item_detail_info_title").first().text());
  const makerName = extraTagLinks($, "レーベル", LABEL_TAG_TYPE)[0]?.name;
  const coverImageUrl = $('meta[property="og:image"]').attr("content");
  const section = parseDetailSection($);

  return {
    credits,
    genres: [...categories, ...keywords],
    ...(title === "" ? {} : { title }),
    ...(makerName === undefined ? {} : { makerName }),
    ...(categories[0] === undefined ? {} : { storeCategory: categories[0] }),
    ...(coverImageUrl === undefined ? {} : { coverImageUrl }),
    ...(section === undefined ? {} : { section }),
  };
}

/**
 * 「作品情報」欄のうち、見出しが `header` のものに入っているタグリンク。
 * 見出しで選ぶのは、欄の並び順が作品によって違う (シリーズ欄が無い作品がある) ため
 */
function extraTagLinks($: cheerio.CheerioAPI, header: string, tagType: number): TagLink[] {
  const block = $("div.item_detail_extra")
    .filter(
      (_, element) =>
        normalizeSpace($(element).find("span.item_detail_extra_header").first().text()) === header,
    )
    .first();
  return tagLinksIn($, block, tagType);
}

/** 上部の説明欄 (主要キャストしか出ないことがある)。作品情報欄が取れなかったときだけ使う */
function descTagLinks($: cheerio.CheerioAPI, title: string, tagType: number): TagLink[] {
  const block = $("div.item_detail_info_desc")
    .filter(
      (_, element) =>
        normalizeSpace($(element).find("div.item_detail_info_desc_title").first().text()) === title,
    )
    .first();
  return tagLinksIn($, block, tagType);
}

function tagLinksIn(
  $: cheerio.CheerioAPI,
  block: ReturnType<typeof $>,
  tagType: number,
): TagLink[] {
  return block
    .find(`a[href*="tag_type=${tagType}"]`)
    .map((_, element) => ({
      name: normalizeSpace($(element).text()),
      href: $(element).attr("href") ?? "",
    }))
    .get()
    .filter((link) => link.name !== "");
}

/**
 * リンクの href から tag_id を読み、表記と組にする。
 * tag_id を読めないリンクは捨てる。「同じ tag_id なら同一人物」という事実が拾えないため
 */
function toCredits(links: readonly TagLink[]): PokedoraCredit[] {
  const credits: PokedoraCredit[] = [];
  const seen = new Set<number>();

  for (const link of links) {
    // XML 由来の href では `&` が `&amp;` で来ることがあるので両方読めるようにする
    const tagId = Number(/[?&](?:amp;)?tag_id=(\d+)/.exec(link.href)?.[1]);
    if (!Number.isInteger(tagId) || seen.has(tagId)) continue;
    seen.add(tagId);
    credits.push({ name: link.name, tagId });
  }
  return credits;
}

/**
 * 作品が属するストア区分。
 *
 * 1. ヘッダ検索フォームの `select[name=store]` で `selected` が付いた option
 * 2. パンくず (JSON-LD の BreadcrumbList) の 2 段目のリンク
 *
 * 2 を予備にしてあるのは、パンくず側が一般を `store=home` と書いており
 * (`select` は `men`)、値の語彙が 1 つずれているため。読み替えてから使う
 */
function parseDetailSection($: cheerio.CheerioAPI): PokedoraSection | undefined {
  const selected = $('select[name="store"] option[selected]').first().attr("value");
  if (isPokedoraSection(selected)) return selected;

  for (const element of $('script[type="application/ld+json"]').toArray()) {
    const matched = /[?&]store=([a-z-]+)/.exec($(element).text());
    const value = matched?.[1] === "home" ? "men" : matched?.[1];
    if (isPokedoraSection(value)) return value;
  }
  return undefined;
}

/**
 * 一覧から作った `RawWork` に詳細ページの情報を上書きする。詳細のほうが確度が高い。
 * 発売日はどちらにも無いので、ここでも `releaseDate` は付けない
 */
export function applyProductDetail(work: RawWork, detail: PokedoraProductDetail): RawWork {
  return {
    ...work,
    creditedNames:
      detail.credits.length > 0 ? detail.credits.map((credit) => credit.name) : work.creditedNames,
    titleRaw: detail.title ?? work.titleRaw,
    makerName: detail.makerName ?? work.makerName,
    storeCategory: detail.storeCategory ?? work.storeCategory,
    genres: detail.genres.length > 0 ? detail.genres : work.genres,
    coverImageUrl: detail.coverImageUrl ?? work.coverImageUrl,
    storeSection: detail.section ?? work.storeSection,
  };
}

// --- 取得 ------------------------------------------------------------------

/** 1 つの (tag_id, ストア区分) を引いた結果 */
type SectionResult = {
  works: RawWork[];
  totalCount?: number;
  pages: number;
  invalidCount: number;
  warnings: string[];
};

/**
 * 1 つの (tag_id, ストア区分) の作品一覧を、総件数に届くまでページを繰って集める。
 * ポケドラのタグページは無限スクロール (autopager) で、次ページのリンクが HTML に出ない。
 * 総件数と取得件数を比べて自分でページを進める
 */
async function fetchSection(
  tagId: number,
  section: PokedoraSection,
  fetchedAt: string,
  options: FetchByActorOptions,
): Promise<SectionResult> {
  const works = new Map<string, RawWork>();
  const warnings: string[] = [];
  let invalidCount = 0;
  let totalCount: number | undefined;
  let pages = 0;

  for (let pageno = 1; pageno <= MAX_PAGES; pageno += 1) {
    const result = await fetchText(buildTagPageUrl(tagId, section, pageno), {
      store: STORE_SLUG,
      requestKey: `tag-${tagId}-${section}-p${pageno}`,
      kind: "html",
      snapshot: options.snapshot,
    });
    if (!result.ok) {
      warnings.push(`tag_id=${tagId} ${section} ${pageno} ページ目の取得に失敗: ${result.reason}`);
      break;
    }

    pages += 1;
    const parsed = parseSearchHtml(result.body, fetchedAt);
    invalidCount += parsed.invalidCount;
    warnings.push(...parsed.warnings);
    // 総件数は 1 ページ目のものを採る。ページを繰る途中で在庫が動いても基準を動かさないため
    if (totalCount === undefined) totalCount = parsed.totalCount;

    const before = works.size;
    for (const work of parsed.works) works.set(work.storeProductId, work);
    // 新しい ID が 1 件も増えないページに当たったら、それ以上繰っても同じものしか出てこない
    if (works.size === before) break;
    if (totalCount === undefined || works.size >= totalCount) break;
  }

  return {
    works: [...works.values()],
    pages,
    invalidCount,
    warnings,
    ...(totalCount === undefined ? {} : { totalCount }),
  };
}

/**
 * 辞書が持っているストア別件数を見て、引く必要のある区分だけを返す。
 *
 * 0 件と分かっている区分のページを引かないことで、段階 3 の所要が 3.3 時間から
 * 1.6 時間に縮む (ポケドラ交差調査 §7-1)。件数が辞書に無いときは両方引く
 */
export function sectionsToFetch(ref: StoreActorRef): PokedoraSection[] {
  if (ref.counts === undefined) return [...POKEDORA_SECTIONS];
  return POKEDORA_SECTIONS.filter((section) => (ref.counts?.[section] ?? 0) > 0);
}

async function fetchByActor(
  actor: ActorQuery,
  options: FetchByActorOptions = {},
): Promise<AdapterResult> {
  const fetchedAt = new Date().toISOString();
  const refs = actor.storeActorRefs?.pokedora ?? [];
  const base = {
    storeSlug: STORE_SLUG,
    actorName: actor.canonicalName,
    status: "ok" as const,
    works: [] as RawWork[],
    invalidCount: 0,
    warnings: [] as string[],
  } satisfies AdapterResult;

  if (refs.length === 0) {
    // ポケドラは名前で検索しない。tag_id が無い声優はそもそも引けないので、
    // 失敗ではなく「該当なし」として記録する (run.ts は辞書に無い声優をここまで運ばない)
    return { ...base, status: "empty", reason: "声優タグ辞書に tag_id が無い" };
  }

  const listWorks = new Map<string, RawWork>();
  const warnings: string[] = [];
  const tagIdsUsed: number[] = [];
  let attemptedSections = 0;
  let invalidCount = 0;
  let pages = 0;
  let total: number | undefined;

  for (const ref of refs) {
    const tagId = Number(ref.externalId);
    if (!Number.isInteger(tagId)) {
      warnings.push(`tag_id として読めない値を渡された: ${ref.externalId}`);
      continue;
    }
    // 同名で tag_id が 2 つある声優が 7 組ある (ポケドラ交差調査 §8)。両方引いて和集合にする
    tagIdsUsed.push(tagId);

    for (const section of sectionsToFetch(ref)) {
      attemptedSections += 1;
      const result = await fetchSection(tagId, section, fetchedAt, options);
      pages += result.pages;
      invalidCount += result.invalidCount;
      warnings.push(...result.warnings);
      for (const work of result.works) listWorks.set(work.storeProductId, work);
      // 区分ごとの総件数を足す。1 作品は 1 つの区分にしか属さないので、単純な和で数えられる
      if (result.totalCount !== undefined) total = (total ?? 0) + result.totalCount;
    }
  }

  // 実際に検索に使った語として tag_id を残す。名前で引いていないことが集計表から分かる
  const queryUsed = tagIdsUsed.length === 0 ? undefined : `tag_id=${tagIdsUsed.join(",")}`;

  if (attemptedSections === 0) {
    // 辞書が「一般も BL も 0 件」と言っている。取得しにいかないので失敗ではない
    return {
      ...base,
      status: "empty",
      reason: "辞書上、一般・BL とも 0 件",
      warnings,
      ...(queryUsed === undefined ? {} : { queryUsed }),
    };
  }
  if (pages === 0) {
    // 引きにはいったが 1 枚も取れなかった。0 件と混ぜると管理画面で壊れに気づけない
    return {
      ...base,
      status: "error",
      reason: "タグページを 1 枚も取得できなかった",
      warnings,
      ...(queryUsed === undefined ? {} : { queryUsed }),
    };
  }

  const coverage = buildCoverage(listWorks.size, total, pages);
  if (coverage.complete === false) {
    warnings.push(`網羅率 ${coverage.fetched}/${coverage.total}`);
  }

  const works: RawWork[] = [];
  // 詳細ページで見えた (tag_id, 表記) の組。別名義の根拠として呼び出し側が貯める
  const observedActorRefs: ObservedActorRef[] = [];

  for (const listWork of listWorks.values()) {
    if (options.skipKnownIds?.has(listWork.storeProductId) === true) {
      // 既知の作品は詳細を取り直さない。1 往復 5 秒なのでここが全体の所要をほぼ決める
      works.push(listWork);
      continue;
    }

    const detailResult = await fetchText(buildProductUrl(listWork.storeProductId), {
      store: STORE_SLUG,
      requestKey: `product-${listWork.storeProductId}`,
      kind: "html",
      snapshot: options.snapshot,
    });
    if (!detailResult.ok) {
      warnings.push(
        `${listWork.storeProductId}: 詳細ページの取得に失敗 (${detailResult.reason})。一覧の情報だけで続行`,
      );
      works.push(listWork);
      continue;
    }

    const detail = parseProductDetail(detailResult.body);
    if (detail.credits.length === 0) {
      // 出演声優が 1 人も取れない作品は、パーサーが壊れた合図でもある。捨てずに警告に残す
      warnings.push(`${listWork.storeProductId}: 詳細ページから出演声優を取れなかった`);
    }
    for (const credit of detail.credits) {
      observedActorRefs.push({ externalId: String(credit.tagId), name: credit.name });
    }

    const detailed = applyProductDetail(listWork, detail);
    // 一般 / BL しか引かないので現状ここで落ちる作品は無いが、判定はドメイン層に任せておく。
    // 将来オトナ向けを引く判断をしたときに、このアダプタ側の修正が要らないようにするため
    if (!isAgeRatingAllowed(detailed.ageRating)) {
      warnings.push(`${listWork.storeProductId}: 対象外の年齢区分のため除外`);
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
    observedActorRefs,
    ...(queryUsed === undefined ? {} : { queryUsed }),
    ...(coverage.total === undefined ? {} : { totalCount: coverage.total }),
  };
}

export const pokedoraAdapter: SourceAdapter = {
  storeSlug: STORE_SLUG,
  fetchByActor,
  parseSearchHtml,
};
