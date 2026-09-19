import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  decodeSitemapBytes,
  extractActorName,
  parseStoreCounts,
  parseTagSitemap,
  summarizeRecords,
  tagPageUrl,
  voiceActorTagIds,
} from "./pokedora-tags.ts";

/** 実際の sitemap_tags_1.xml.gz と同じ形 (2026-09-18 取得)。`&` が `&amp;` で来るのが要点 */
const TAG_SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
	<url>
		<loc>https://pokedora.com/tags/?tag_type=1&amp;tag_id=1920</loc>
		<lastmod>2026-09-15T03:01:03+09:00</lastmod>
	</url>
	<url>
		<loc>https://pokedora.com/tags/?tag_type=1&amp;tag_id=25</loc>
	</url>
	<url>
		<loc>https://pokedora.com/tags/?tag_type=2&amp;tag_id=777</loc>
	</url>
	<url>
		<loc>https://pokedora.com/tags/?tag_type=3&amp;tag_id=12</loc>
	</url>
	<url>
		<loc>https://pokedora.com/products/list.php</loc>
	</url>
</urlset>`;

/** 実際のタグページと同じ形。件数タブは 4 ストアぶん並ぶ */
const TAG_PAGE_HTML = `<!DOCTYPE html>
<html><head>
<title>声優【小林千晃】のボイス・ASMR、音声配信、シチュエーションCD 一覧 | ポケットドラマCD(ポケドラ)</title>
</head><body>
<ul class="category_tab">
  <li class="category_tab_el category_tab_el-men">
    <a class="action_store_change" data-store="men"><div>
      <div>一般</div><div>(10件)</div>
    </div></a>
  </li>
  <li class="category_tab_el category_tab_el-bl">
    <a class="action_store_change" data-store="bl"><div>
      <div>BL</div><div>(66件)</div>
    </div></a>
  </li>
  <li class="category_tab_el category_tab_el-adt">
    <a class="action_store_change" data-store="adt"><div>
      <div>オトナ向け</div><div>(3件)</div>
    </div></a>
  </li>
  <li class="category_tab_el category_tab_el-adt-bl">
    <a class="action_store_change" data-store="adt-bl"><div>
      <div>オトナBL</div><div>(7件)</div>
    </div></a>
  </li>
</ul>
</body></html>`;

describe("decodeSitemapBytes", () => {
  it("gzip されたバイト列を展開する", () => {
    const bytes = new Uint8Array(gzipSync(Buffer.from(TAG_SITEMAP_XML, "utf8")));
    expect(decodeSitemapBytes(bytes)).toBe(TAG_SITEMAP_XML);
  });

  it("サーバーが展開済みで返したときはそのまま読む", () => {
    const bytes = new Uint8Array(Buffer.from(TAG_SITEMAP_XML, "utf8"));
    expect(decodeSitemapBytes(bytes)).toBe(TAG_SITEMAP_XML);
  });
});

describe("parseTagSitemap", () => {
  it("&amp; で区切られた tag_type と tag_id を取る", () => {
    expect(parseTagSitemap(TAG_SITEMAP_XML)).toEqual([
      { tagType: 1, tagId: 1920 },
      { tagType: 1, tagId: 25 },
      { tagType: 2, tagId: 777 },
      { tagType: 3, tagId: 12 },
    ]);
  });

  it("タグ以外の URL は落とす", () => {
    expect(parseTagSitemap("<loc>https://pokedora.com/products/list.php</loc>")).toEqual([]);
  });
});

describe("voiceActorTagIds", () => {
  it("tag_type=1 だけを昇順で返す", () => {
    expect(voiceActorTagIds(parseTagSitemap(TAG_SITEMAP_XML))).toEqual([25, 1920]);
  });

  it("同じ tag_id が二度出ても 1 件にする", () => {
    const entries = [
      { tagType: 1, tagId: 5 },
      { tagType: 1, tagId: 5 },
    ];
    expect(voiceActorTagIds(entries)).toEqual([5]);
  });
});

describe("extractActorName", () => {
  it("title の【】から声優名を取る", () => {
    expect(extractActorName(TAG_PAGE_HTML)).toBe("小林千晃");
  });

  it("声優以外の tag_type のページからは取らない", () => {
    const series = "<title>シリーズ【噺の籠】の一覧 | ポケットドラマCD</title>";
    expect(extractActorName(series)).toBeUndefined();
  });

  it("title が無いページでは undefined", () => {
    expect(extractActorName("<html><body>404</body></html>")).toBeUndefined();
  });
});

describe("parseStoreCounts", () => {
  it("4 ストアの件数を取る", () => {
    expect(parseStoreCounts(TAG_PAGE_HTML)).toEqual({
      men: 10,
      bl: 66,
      adt: 3,
      "adt-bl": 7,
    });
  });

  it("オトナ向けとオトナBL を取り違えない (クラス名が前方一致するため)", () => {
    const counts = parseStoreCounts(TAG_PAGE_HTML);
    expect(counts?.adt).toBe(3);
    expect(counts?.["adt-bl"]).toBe(7);
  });

  it("タブが 4 つ揃わないときは部分的な数字を返さない", () => {
    const partial = TAG_PAGE_HTML.replace(
      /<li class="category_tab_el category_tab_el-bl">[\s\S]*?<\/li>/,
      "",
    );
    expect(parseStoreCounts(partial)).toBeUndefined();
  });
});

describe("tagPageUrl", () => {
  it("年齢認証の背後にある store 引数を付けない", () => {
    expect(tagPageUrl(1920)).toBe("https://pokedora.com/tags/?tag_type=1&tag_id=1920");
  });
});

describe("summarizeRecords", () => {
  it("状態ごとに数え、失敗は HTTP ステータス別に内訳を出す", () => {
    const summary = summarizeRecords([
      { tagId: 1, status: "ok", name: "甲", fetchedAt: "2026-09-18T00:00:00.000Z" },
      { tagId: 2, status: "no-name", fetchedAt: "2026-09-18T00:00:05.000Z" },
      {
        tagId: 3,
        status: "failed",
        httpStatus: 404,
        reason: "x",
        fetchedAt: "2026-09-18T00:00:10.000Z",
      },
      { tagId: 4, status: "failed", reason: "TimeoutError", fetchedAt: "2026-09-18T00:00:15.000Z" },
    ]);
    expect(summary).toEqual({
      total: 4,
      ok: 1,
      noName: 1,
      failed: 2,
      failuresByStatus: { "404": 1, network: 1 },
    });
  });
});
