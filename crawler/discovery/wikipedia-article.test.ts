import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES_DIR } from "../lib/paths.ts";
import {
  articleTitles,
  articleUrl,
  kanaFromArticle,
  parseArticle,
  type WikipediaArticle,
} from "./wikipedia-article.ts";

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, `wikipedia-ja-${name}.html`), "utf8");
}

/** フィクスチャ 1 本を、要求した記事名で引いたときの結果にする */
function kanaOf(name: string, requestedTitle: string, canonicalName: string) {
  return kanaFromArticle({
    requestedTitle,
    canonicalName,
    article: parseArticle(fixture(name)),
  });
}

describe("articleTitles / articleUrl", () => {
  it("引いてよい記事名は素の名前と (声優) 付きの 2 通りだけ", () => {
    expect(articleTitles("上田麗奈")).toEqual(["上田麗奈", "上田麗奈_(声優)"]);
  });

  it("名前の空白は _ にする (空白のままだと 301 が返る)", () => {
    expect(articleTitles("ブリドカット セーラ 恵美")[0]).toBe("ブリドカット_セーラ_恵美");
  });

  it("名前が空なら引かない", () => {
    expect(articleTitles("   ")).toEqual([]);
  });

  it("URL にクエリパラメータを付けない", () => {
    expect(articleUrl("天野聡美_(声優)")).toBe(
      "https://ja.wikipedia.org/wiki/%E5%A4%A9%E9%87%8E%E8%81%A1%E7%BE%8E_(%E5%A3%B0%E5%84%AA)",
    );
  });
});

describe("parseArticle", () => {
  it("着地した記事名・カテゴリ・ふりがなを取る", () => {
    const article = parseArticle(fixture("ueda-reina"));
    expect(article.pageName).toBe("上田麗奈");
    expect(article.furigana).toBe("うえだ れいな");
    expect(article.categories).toContain("日本の女性声優");
  });

  it("カテゴリのソートキー (#以降) は名前に含めない", () => {
    const article = parseArticle(fixture("ueda-reina"));
    expect(article.categories).toContain("編集拡張半保護中のページ");
  });

  it("転送された記事では着地した記事名が返る", () => {
    expect(parseArticle(fixture("asano-ruri-redirect")).pageName).toBe("朝ノ姉妹ぷろじぇくと");
  });

  it("Template:声優 以外のテンプレートの ふりがな は取らない", () => {
    // Template:ActorActress の ふりがな は「みつしま ひかり」だが、本人の読みだと機械では言えない
    expect(parseArticle(fixture("mitsushima-hikari")).furigana).toBeUndefined();
  });

  it("導入部の <b>名前</b>（かな、 から読みを取る", () => {
    // Template:ActorActress しか無い記事なので、ふりがな 引数からは取れない
    const article = parseArticle(fixture("yamaji-kazuhiro"));
    expect(article.furigana).toBeUndefined();
    expect(article.leadReading).toBe("やまじ かずひろ");
  });

  it("読みの直後に脚注が入っても、読みだけを取る", () => {
    // 麦人 の導入部は「（むぎひと[注 2]、1944年…」で、同じ段落の後ろに別の括弧 (（代表）) がある
    expect(parseArticle(fixture("mugihito")).leadReading).toBe("むぎひと");
  });

  it("記事名と違う名前の太字からは読みを取らない", () => {
    expect(parseArticle(leadOfAnotherName)).toMatchObject({ pageName: "麦人" });
    expect(parseArticle(leadOfAnotherName).leadReading).toBeUndefined();
  });

  it("Wikidata の項目 id を取る", () => {
    expect(parseArticle(fixture("yamaji-kazuhiro")).wikibaseItemId).toBe("Q3546378");
  });

  it("項目 id を持たない記事では undefined", () => {
    expect(parseArticle(fixture("ueda-reina")).wikibaseItemId).toBeUndefined();
  });
});

/** 導入部の太字が記事名ではない記事。別人の読みを本人のものとして取らないことを見る */
const leadOfAnotherName = `<!DOCTYPE html><html><head>
<script>RLCONF={"wgPageName":"麦人"};</script></head>
<body><div class="mw-parser-output">
<p><b>寺田 誠</b>（てらだ まこと、1944年8月8日 - ）は、日本の俳優。</p>
</div></body></html>`;

describe("kanaFromArticle", () => {
  it("3 条件を満たす記事からかなを取る", () => {
    expect(kanaOf("ueda-reina", "上田麗奈", "上田麗奈")).toEqual({
      kana: "うえだれいな",
      raw: "うえだ れいな",
      source: "furigana",
    });
  });

  it("(声優) 付きの記事名でも同じように取れる", () => {
    expect(kanaOf("amano-satomi-actor", "天野聡美_(声優)", "天野聡美")).toEqual({
      kana: "あまのさとみ",
      raw: "あまの さとみ",
      source: "furigana",
    });
  });

  it("名前そのものがかなの声優は、名前をかなとして扱う", () => {
    // 記事の ふりがな が空になるのはこの人たちだけ (研究の 5 件)
    expect(kanaOf("yukana", "ゆかな", "ゆかな")).toEqual({
      kana: "ゆかな",
      raw: "ゆかな",
      source: "kana-name",
    });
  });

  it("別の記事に転送されたら取らない", () => {
    expect(kanaOf("asano-ruri-redirect", "朝ノ瑠璃", "朝ノ瑠璃")).toEqual({
      rejected: "redirected",
    });
  });

  it("曖昧さ回避のページからは取らない", () => {
    expect(kanaOf("amano-satomi-disambig", "天野聡美", "天野聡美")).toEqual({
      rejected: "disambiguation",
    });
  });

  it("声優のカテゴリが無い記事からは取らない", () => {
    expect(kanaOf("mitsushima-hikari", "満島ひかり", "満島ひかり")).toEqual({
      rejected: "not-voice-actor",
    });
  });

  it("転送された記事は、読みが書いてあっても条件を先に見て捨てる", () => {
    // 転送先がユニットや事務所だと、そこの読みが本人の読みとして入ってしまう
    const article: WikipediaArticle = {
      pageName: "賢プロダクション",
      categories: ["日本の女性声優"],
      furigana: "けんプロダクション",
    };
    expect(kanaFromArticle({ requestedTitle: "木花藍", canonicalName: "木花藍", article })).toEqual(
      {
        rejected: "redirected",
      },
    );
  });

  it("「声優」を含むカテゴリなら管理用のカテゴリでも条件を満たす", () => {
    // 条件は docs/research/actor-kana-sources-2026-09-20.md の字面どおり「声優」を含むこと。
    // 記事の整備状況を表すカテゴリ (注意がある記事 (声優) など) しか無い記事もこれで通る
    const article: WikipediaArticle = {
      pageName: "架空声優",
      categories: ["注意がある記事 (声優)", "声優関連のスタブ項目"],
      furigana: "かくう せいゆう",
    };
    expect(
      kanaFromArticle({ requestedTitle: "架空声優", canonicalName: "架空声優", article }),
    ).toEqual({ kana: "かくうせいゆう", raw: "かくう せいゆう", source: "furigana" });
  });

  it("読みが無く名前もかなでなければ取らない", () => {
    const article: WikipediaArticle = { pageName: "麦人", categories: ["日本の男性声優"] };
    expect(kanaFromArticle({ requestedTitle: "麦人", canonicalName: "麦人", article })).toEqual({
      rejected: "no-kana",
    });
  });

  it("着地した記事名が取れない HTML からは取らない", () => {
    const article: WikipediaArticle = { categories: ["日本の女性声優"], furigana: "あ" };
    expect(kanaFromArticle({ requestedTitle: "あ", canonicalName: "あ", article })).toEqual({
      rejected: "redirected",
    });
  });
});
