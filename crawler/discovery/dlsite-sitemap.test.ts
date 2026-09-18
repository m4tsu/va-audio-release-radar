import { describe, expect, it } from "vitest";
import {
  extractWorkno,
  isWorkSitemapUrl,
  mergeEntries,
  parseSitemapIndex,
  parseWorkSitemap,
  rjNumberOf,
  summarizeChildSitemap,
} from "./dlsite-sitemap.ts";

/** 実際の home_index.xml と同じ形 (2026-09-18 取得) */
const INDEX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://www.dlsite.com/modpub/sitemap-xml/nodes/20260917/home/pages.xml</loc></sitemap>
  <sitemap><loc>https://www.dlsite.com/modpub/sitemap-xml/nodes/20260917/home/work_0.xml</loc></sitemap>
  <sitemap><loc>https://www.dlsite.com/modpub/sitemap-xml/nodes/20260917/home/work_ana.xml</loc></sitemap>
  <sitemap><loc>https://www.dlsite.com/modpub/sitemap-xml/nodes/20260917/home/circle_0.xml</loc></sitemap>
  <sitemap><loc>https://www.dlsite.com/modpub/sitemap-xml/nodes/20260917/home/work_review_list_0.xml</loc></sitemap>
</sitemapindex>`;

/** 実際の work_N.xml と同じ形。1 ブロックに同じ product_id が 5 回現れるのが要点 */
const WORK_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://www.dlsite.com/home/work/=/product_id/RJ320937.html</loc>
    <lastmod>2021-04-03T14:32:12+09:00</lastmod>
    <priority>1.0</priority>
    <xhtml:link rel="alternate" media="only screen and (max-width: 640px)" href="https://www.dlsite.com/home-touch/work/=/product_id/RJ320937.html"/>
    <xhtml:link rel="alternate" hreflang="en" href="https://www.dlsite.com/home/work/=/product_id/RJ320937.html/?locale=en_US"/>
  </url>
  <url>
    <loc>https://www.dlsite.com/home/work/=/product_id/RJ01698658.html</loc>
    <lastmod>2026-08-22T00:00:00+09:00</lastmod>
  </url>
  <url>
    <loc>https://www.dlsite.com/home/circle/profile/=/maker_id/RG12345.html</loc>
    <lastmod>2026-09-01T00:00:00+09:00</lastmod>
  </url>
</urlset>`;

describe("parseSitemapIndex", () => {
  it("子 sitemap の URL をすべて取る", () => {
    expect(parseSitemapIndex(INDEX_XML)).toHaveLength(5);
  });
});

describe("isWorkSitemapUrl", () => {
  it("作品を載せている sitemap だけを選ぶ", () => {
    const works = parseSitemapIndex(INDEX_XML).filter(isWorkSitemapUrl);
    expect(works.map((url) => url.split("/").at(-1))).toEqual(["work_0.xml", "work_ana.xml"]);
  });

  it("work_review_list は作品 URL を持たないので選ばない", () => {
    expect(isWorkSitemapUrl("https://x/work_review_list_0.xml")).toBe(false);
  });
});

describe("parseWorkSitemap", () => {
  it("1 ブロックにつき 1 件だけ数える (多言語版の重複を拾わない)", () => {
    const parsed = parseWorkSitemap(WORK_XML);
    expect(parsed.urlCount).toBe(3);
    expect(parsed.entries.map((entry) => entry.workno)).toEqual(["RJ320937", "RJ01698658"]);
  });

  it("lastmod をそのまま持つ", () => {
    const parsed = parseWorkSitemap(WORK_XML);
    expect(parsed.entries[0]?.lastmod).toBe("2021-04-03T14:32:12+09:00");
  });

  it("作品以外 (サークルページ) は捨てる", () => {
    expect(parseWorkSitemap(WORK_XML).entries).toHaveLength(2);
  });
});

describe("rjNumberOf", () => {
  it("先頭 0 の有無で番号が変わらない", () => {
    // DLsite は途中から 8 桁ゼロ埋めに変わったので、数値に寄せないと新旧を並べ替えられない
    expect(rjNumberOf("RJ01698658")).toBe(1698658);
    expect(rjNumberOf("RJ320937")).toBe(320937);
    expect(rjNumberOf("RG12345")).toBeUndefined();
  });
});

describe("extractWorkno", () => {
  it("商品 URL 以外からは取らない", () => {
    expect(extractWorkno("https://www.dlsite.com/home/work/=/product_id/RJ01.html")).toBe("RJ01");
    expect(
      extractWorkno("https://www.dlsite.com/home/circle/profile/=/maker_id/RG1.html"),
    ).toBeUndefined();
  });
});

describe("mergeEntries", () => {
  it("RJ 番号で重複を落とし、新しい順に並べる", () => {
    const merged = mergeEntries([
      { workno: "RJ100", rjNumber: 100 },
      { workno: "RJ00000100", rjNumber: 100, lastmod: "2026-09-01" },
      { workno: "RJ300", rjNumber: 300 },
    ]);
    expect(merged.map((entry) => entry.rjNumber)).toEqual([300, 100]);
    // lastmod がより新しいほうを残す
    expect(merged[1]?.lastmod).toBe("2026-09-01");
  });
});

describe("summarizeChildSitemap", () => {
  it("RJ 番号の範囲と lastmod の月別件数を出す", () => {
    const stat = summarizeChildSitemap("https://x/work_0.xml", parseWorkSitemap(WORK_XML));
    expect(stat).toMatchObject({
      urlCount: 3,
      workCount: 2,
      minRjNumber: 320937,
      maxRjNumber: 1698658,
      lastmodByMonth: { "2021-04": 1, "2026-08": 1 },
    });
  });
});
