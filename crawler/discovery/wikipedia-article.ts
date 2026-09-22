import * as cheerio from "cheerio";
import { toStoredKana } from "./kana-text.ts";

/**
 * 日本語版 Wikipedia の記事 HTML から、声優のかなに要る事実だけを取り出す純粋関数。
 *
 * ここは fetch も fs も触らない。取得と再開は `wikipedia-kana.ts` が持つ。
 * 取ってよい記事の条件 (要求した記事名と着地した記事名の一致 / 声優のカテゴリ /
 * 曖昧さ回避でないこと) は
 * `docs/research/actor-kana-sources-2026-09-20.md` の「同名の別人を取り違えない条件」に従う。
 * 条件を緩めると、同名の別人やユニット・事務所の読みが混ざる
 */

/** 記事 HTML から取れた事実。どれも無いことがある */
export type WikipediaArticle = {
  /** 着地した記事名 (`wgPageName`)。リダイレクトされるとここが要求した名前と変わる */
  pageName?: string;
  /** カテゴリ名。`_` は空白に直し、パーセント符号化は戻してある */
  categories: string[];
  /** テンプレートの `ふりがな` 引数に書かれていた文字列 (wikitext のまま) */
  furigana?: string;
  /** 導入部の `<b>名前</b>（かな、` の括弧の先頭に書かれていた文字列 */
  leadReading?: string;
  /** 対応する Wikidata の項目 id (`wgWikibaseItemId`)。記事から項目へ辿れる唯一の手がかり */
  wikibaseItemId?: string;
};

/** 記事からかなを取らなかった理由 */
export type KanaRejection = "redirected" | "disambiguation" | "not-voice-actor" | "no-kana";

export type KanaOutcome =
  | {
      /** 保存する形に直したかな (空白なしのひらがな) */
      kana: string;
      /** 記事に書かれていたままの値。後から取り違えを追えるように残す */
      raw: string;
      /** furigana=テンプレートの引数 / kana-name=名前そのものがかな */
      source: "furigana" | "kana-name";
    }
  | { rejected: KanaRejection };

// --- 記事名と URL ----------------------------------------------------------

/** 記事名に空白を入れると 301 が返り、`fetch.ts` はリダイレクトを追わないので `_` に直す */
function toArticleTitle(name: string): string {
  return name.trim().replace(/\s+/g, "_");
}

/**
 * 1 人につき要求してよい記事名。この 2 通り以外は引かない。
 * 3 通目 (`<名前>_(声優、○○)` など) を足すと、記事名の一致だけでは本人と言えなくなる
 */
export function articleTitles(canonicalName: string): string[] {
  const title = toArticleTitle(canonicalName);
  return title === "" ? [] : [title, `${title}_(声優)`];
}

/**
 * 記事の URL。クエリパラメータを付けない (docs/stores/wikimedia.md の「使う URL」)。
 * `encodeURIComponent` は `_` と `(` `)` をそのまま残すので、記事名の形が URL に出る
 */
export function articleUrl(title: string): string {
  return `https://ja.wikipedia.org/wiki/${encodeURIComponent(title)}`;
}

// --- HTML の解析 -----------------------------------------------------------

/** `"wgPageName":"上田麗奈"` の値。JSON 文字列としてエスケープされている */
const PAGE_NAME_PATTERN = /"wgPageName"\s*:\s*("(?:[^"\\]|\\.)*")/;

/** `"wgWikibaseItemId":"Q3546378"` の値。項目が無い記事にはこの変数が出ない */
const WIKIBASE_ITEM_ID_PATTERN = /"wgWikibaseItemId"\s*:\s*"(Q\d+)"/;

function parsePageName(html: string): string | undefined {
  const raw = PAGE_NAME_PATTERN.exec(html)?.[1];
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as string;
  } catch {
    return undefined;
  }
}

/** `./Category:日本の女性声優` の形から名前だけ取る。`#` 以降はソートキーなので落とす */
function parseCategoryHref(href: string): string | undefined {
  const name = /^\.\/Category:([^#]+)/.exec(href)?.[1];
  if (name === undefined || name === "") return undefined;
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    // 不正なパーセント符号化はそのまま使う。判定に使うのは部分一致なので落とすほうが損
  }
  return decoded.replace(/_/g, " ");
}

/**
 * テンプレート呼び出しの記録 (`data-mw` 属性の JSON) から `ふりがな` 引数を取る。
 *
 * `Template:声優` の引数だけを見る。同じ記事に別のテンプレート
 * (`Template:ActorActress` や家族・共演者の情報枠) の `ふりがな` があることがあり、
 * それが本人の読みだとは記事名とカテゴリからは言えない。
 * `docs/research/actor-kana-sources-2026-09-20.md` が数えたのもこのテンプレートの引数
 */
const VOICE_ACTOR_TEMPLATE = "./Template:声優";

type TemplatePart = {
  template?: {
    target?: { href?: string };
    params?: Record<string, { wt?: string } | undefined>;
  };
};

function furiganaFromDataMw(dataMw: string): string[] {
  let parsed: { parts?: unknown };
  try {
    parsed = JSON.parse(dataMw) as { parts?: unknown };
  } catch {
    return [];
  }
  const parts = Array.isArray(parsed.parts) ? (parsed.parts as TemplatePart[]) : [];
  const found: string[] = [];
  for (const part of parts) {
    const template = part?.template;
    if (template?.target?.href !== VOICE_ACTOR_TEMPLATE) continue;
    const furigana = template.params?.ふりがな?.wt;
    if (furigana === undefined || furigana.trim() === "") continue;
    found.push(furigana);
  }
  return found;
}

/** 記事名と導入部の太字を比べる形に揃える。`wgPageName` は空白を `_` で持つ */
function withoutSeparators(value: string): string {
  return value.normalize("NFC").replace(/[\s_]+/gu, "");
}

/** 連続する空白を 1 つに畳む。改行やタグの境界で入る空白を読みの比較から外すため */
function collapseSpaces(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

/**
 * 導入部の `<b>名前</b>（かな、…` から括弧の先頭を取る。
 *
 * 起点は**記事名と一致する太字**に限る。括弧だけを探すと、読みの直後に脚注が入る記事で
 * 導入部を読み飛ばし、別の段落の括弧 (出演作の役名など) を拾う
 * (`docs/research/actor-kana-sources-2026-09-20.md` の `麦人`)。
 * 脚注の番号は `<sup>` に入るので、本文を読む前に落とす
 */
function parseLeadReading($: cheerio.CheerioAPI, pageName: string): string | undefined {
  const wanted = withoutSeparators(pageName);
  for (const element of $("p").toArray()) {
    const bold = $(element).find("b").first();
    if (bold.length === 0 || withoutSeparators(bold.text()) !== wanted) continue;
    const paragraph = $(element).clone();
    paragraph.find("sup").remove();
    const text = collapseSpaces(paragraph.text());
    const name = collapseSpaces(bold.text());
    if (name === "" || !text.startsWith(name)) continue;
    const reading = /^（\s*([^（）]+?)\s*[、）]/u.exec(text.slice(name.length))?.[1];
    if (reading !== undefined) return reading;
  }
  return undefined;
}

export function parseArticle(html: string): WikipediaArticle {
  const $ = cheerio.load(html);

  const categories: string[] = [];
  for (const element of $('link[rel="mw:PageProp/Category"]').toArray()) {
    const href = $(element).attr("href");
    const name = href === undefined ? undefined : parseCategoryHref(href);
    if (name !== undefined) categories.push(name);
  }

  const candidates: string[] = [];
  for (const element of $("[data-mw]").toArray()) {
    const dataMw = $(element).attr("data-mw");
    if (dataMw === undefined) continue;
    candidates.push(...furiganaFromDataMw(dataMw));
  }
  const furigana = candidates[0];

  const pageName = parsePageName(html);
  const leadReading = pageName === undefined ? undefined : parseLeadReading($, pageName);
  const wikibaseItemId = WIKIBASE_ITEM_ID_PATTERN.exec(html)?.[1];
  return {
    ...(pageName === undefined ? {} : { pageName }),
    categories,
    ...(furigana === undefined ? {} : { furigana }),
    ...(leadReading === undefined ? {} : { leadReading }),
    ...(wikibaseItemId === undefined ? {} : { wikibaseItemId }),
  };
}

// --- かなの取り出し --------------------------------------------------------

function hasCategoryContaining(article: WikipediaArticle, word: string): boolean {
  return article.categories.some((category) => category.includes(word));
}

/** 記事名を比べる形に揃える。`wgPageName` は空白を `_` で持つ */
function comparableTitle(title: string): string {
  return title.normalize("NFC").replace(/\s+/g, "_");
}

/**
 * 記事 1 本からかなを取る。3 つの条件を全て満たさない記事からは取らない。
 *
 * 条件を満たしていて読みが書かれていないときは、名前そのものがかなの声優
 * (`ゆかな` など。テンプレートの `ふりがな` が空になる) だけ名前をかなとして扱う
 */
export function kanaFromArticle(input: {
  requestedTitle: string;
  canonicalName: string;
  article: WikipediaArticle;
}): KanaOutcome {
  const { article } = input;
  if (
    article.pageName === undefined ||
    comparableTitle(article.pageName) !== comparableTitle(input.requestedTitle)
  ) {
    return { rejected: "redirected" };
  }
  if (hasCategoryContaining(article, "曖昧さ回避")) return { rejected: "disambiguation" };
  if (!hasCategoryContaining(article, "声優")) return { rejected: "not-voice-actor" };

  if (article.furigana !== undefined) {
    const fromTemplate = toStoredKana(article.furigana);
    if (fromTemplate !== undefined) {
      return { kana: fromTemplate, raw: article.furigana, source: "furigana" };
    }
  }

  const fromName = toStoredKana(input.canonicalName);
  if (fromName !== undefined) {
    return { kana: fromName, raw: input.canonicalName, source: "kana-name" };
  }
  return { rejected: "no-kana" };
}

/** 理由を人が読む 1 行にする */
export function describeKanaRejection(reason: KanaRejection): string {
  switch (reason) {
    case "redirected":
      return "別の記事に転送された";
    case "disambiguation":
      return "曖昧さ回避のページ";
    case "not-voice-actor":
      return "声優のカテゴリが無い";
    case "no-kana":
      return "読みが書かれていない";
  }
}
