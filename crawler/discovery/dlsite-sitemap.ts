import { fetchText } from "../lib/fetch.ts";

/**
 * DLsite 全年齢サイト (/home/) の sitemap から作品 URL を全件発見する (発見スパイク T9)。
 *
 * 検索 API は声優名を先に知っていないと使えないので、「どの声優が居るか」を調べる用途には
 * 使えない。sitemap は名前を知らなくても全作品を列挙できる唯一の入口なのでこちらを使う。
 *
 * XML パーサーは足さない。sitemap は 1 URL 1 ブロックの単純な構造で、必要なのは
 * `<loc>` と `<lastmod>` だけなので正規表現で足りる (設計書 §2 の「依存は増やさない」)
 */

const SITEMAP_STORE = "dlsite";
export const SITEMAP_INDEX_URL = "https://www.dlsite.com/modpub/sitemap-xml/indexes/home_index.xml";

/** 作品ページの URL から取れる情報 */
export type SitemapWorkEntry = {
  workno: string;
  /** RJ に続く数字。DLsite は概ね発売順に採番するので、新しい作品の絞り込みに使う */
  rjNumber: number;
  /** sitemap の lastmod (ISO 8601)。発売日ではなく「最後に更新された日」 */
  lastmod?: string;
};

/** 子 sitemap 1 本ぶんの集計。報告用 */
export type ChildSitemapStat = {
  url: string;
  /** `<url>` ブロックの総数 (作品以外も含む) */
  urlCount: number;
  /** そのうち作品ページだったもの */
  workCount: number;
  minRjNumber?: number;
  maxRjNumber?: number;
  /** lastmod を年月 ("2026-09") で数えたもの */
  lastmodByMonth: Record<string, number>;
};

// --- XML の解析 (純粋関数) -------------------------------------------------

/** `<sitemapindex>` から子 sitemap の URL を取り出す */
export function parseSitemapIndex(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s][^<]*?)\s*<\/loc>/g)]
    .map((match) => match[1])
    .filter((url): url is string => url !== undefined);
}

/**
 * 子 sitemap のうち作品ページを載せているものだけを選ぶ。
 * circle / ranking / announce / review は作品 URL を持たないので取りに行かない
 * (1 本 18MB あり、無駄に落とすと相手にも自分にも重い)
 */
export function isWorkSitemapUrl(url: string): boolean {
  return /\/work(_[0-9a-z]+)?\.xml$/.test(url);
}

/** `/home/work/=/product_id/RJ01698658.html` → "RJ01698658" */
export function extractWorkno(url: string): string | undefined {
  return /\/product_id\/(RJ\d+)\.html/.exec(url)?.[1] ?? undefined;
}

/** "RJ01698658" → 1698658。先頭 0 込みの表記揺れがあるので数値に寄せて比較する */
export function rjNumberOf(workno: string): number | undefined {
  const digits = /^RJ(\d+)$/.exec(workno)?.[1];
  if (digits === undefined) return undefined;
  const value = Number(digits);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * `<urlset>` から作品ページだけを取り出す。
 *
 * `<url>` ブロックの中には多言語版の `<xhtml:link>` が 4 本入っていて、そこにも同じ
 * product_id が現れる。ブロック単位で切ってから先頭の `<loc>` だけを見ないと、
 * 1 作品を 5 回数えてしまう
 */
export function parseWorkSitemap(xml: string): { entries: SitemapWorkEntry[]; urlCount: number } {
  const entries: SitemapWorkEntry[] = [];
  let urlCount = 0;

  for (const block of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    urlCount += 1;
    const inner = block[1];
    if (inner === undefined) continue;
    const loc = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/.exec(inner)?.[1];
    if (loc === undefined) continue;
    const workno = extractWorkno(loc);
    if (workno === undefined) continue;
    const rjNumber = rjNumberOf(workno);
    if (rjNumber === undefined) continue;
    const lastmod = /<lastmod>\s*([^<\s][^<]*?)\s*<\/lastmod>/.exec(inner)?.[1];
    entries.push({ workno, rjNumber, ...(lastmod === undefined ? {} : { lastmod }) });
  }

  return { entries, urlCount };
}

/** 子 sitemap 1 本の集計を作る */
export function summarizeChildSitemap(
  url: string,
  parsed: { entries: SitemapWorkEntry[]; urlCount: number },
): ChildSitemapStat {
  const lastmodByMonth: Record<string, number> = {};
  let minRjNumber: number | undefined;
  let maxRjNumber: number | undefined;

  for (const entry of parsed.entries) {
    if (minRjNumber === undefined || entry.rjNumber < minRjNumber) minRjNumber = entry.rjNumber;
    if (maxRjNumber === undefined || entry.rjNumber > maxRjNumber) maxRjNumber = entry.rjNumber;
    const month = entry.lastmod?.slice(0, 7);
    if (month !== undefined && month !== "") {
      lastmodByMonth[month] = (lastmodByMonth[month] ?? 0) + 1;
    }
  }

  return {
    url,
    urlCount: parsed.urlCount,
    workCount: parsed.entries.length,
    ...(minRjNumber === undefined ? {} : { minRjNumber }),
    ...(maxRjNumber === undefined ? {} : { maxRjNumber }),
    lastmodByMonth,
  };
}

/**
 * 同じ作品が複数の子 sitemap に載ることがあるので RJ 番号で重複を落とし、新しい順に並べる。
 * lastmod は「より新しいほう」を残す
 */
export function mergeEntries(all: readonly SitemapWorkEntry[]): SitemapWorkEntry[] {
  const byNumber = new Map<number, SitemapWorkEntry>();
  for (const entry of all) {
    const existing = byNumber.get(entry.rjNumber);
    if (existing === undefined) {
      byNumber.set(entry.rjNumber, entry);
      continue;
    }
    if (entry.lastmod !== undefined && (existing.lastmod ?? "") < entry.lastmod) {
      byNumber.set(entry.rjNumber, entry);
    }
  }
  return [...byNumber.values()].sort((a, b) => b.rjNumber - a.rjNumber);
}

// --- 取得 ------------------------------------------------------------------

export type SitemapCrawlResult = {
  indexUrl: string;
  /** index に載っていた子 sitemap 全部 (作品以外も含む。報告用) */
  childUrls: string[];
  /** 実際に取りに行った作品 sitemap の集計 */
  stats: ChildSitemapStat[];
  /** RJ 番号の新しい順、重複排除済み */
  entries: SitemapWorkEntry[];
  warnings: string[];
};

export async function crawlSitemap(
  options: { snapshot?: boolean } = {},
): Promise<SitemapCrawlResult> {
  const warnings: string[] = [];
  const indexResult = await fetchText(SITEMAP_INDEX_URL, {
    store: SITEMAP_STORE,
    requestKey: "sitemap-home_index",
    kind: "html",
    snapshot: options.snapshot,
  });
  if (!indexResult.ok) {
    throw new Error(`sitemap index の取得に失敗: ${indexResult.reason}`);
  }

  const childUrls = parseSitemapIndex(indexResult.body);
  const workSitemapUrls = childUrls.filter(isWorkSitemapUrl);
  const stats: ChildSitemapStat[] = [];
  const all: SitemapWorkEntry[] = [];

  for (const url of workSitemapUrls) {
    const name = url.split("/").at(-1) ?? url;
    // 1 本 18MB ある。スナップショットに残すと 1 回の実行で 160MB 増えるので既定で保存しない。
    // 解析結果は .cache/discovery に JSON で残すため、再現性はそちらで担保する
    const result = await fetchText(url, {
      store: SITEMAP_STORE,
      requestKey: `sitemap-${name}`,
      kind: "html",
      snapshot: options.snapshot === true,
    });
    if (!result.ok) {
      warnings.push(`${name}: 取得に失敗 (${result.reason})`);
      continue;
    }
    const parsed = parseWorkSitemap(result.body);
    stats.push(summarizeChildSitemap(url, parsed));
    all.push(...parsed.entries);
    console.log(
      `  ${name}: url ${parsed.urlCount} 件 / 作品 ${parsed.entries.length} 件 (${Math.round(result.body.length / 1024 / 1024)}MB)`,
    );
  }

  return { indexUrl: SITEMAP_INDEX_URL, childUrls, stats, entries: mergeEntries(all), warnings };
}
