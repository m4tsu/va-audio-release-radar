import { describe, expect, test } from "vitest";
import type { StoreSlug } from "@/domain/types";
import {
  actorInitial,
  arrangeActors,
  availableInitials,
  DEFAULT_ACTOR_SORT,
  isActorSort,
} from "./actor-directory";

type Row = { slug: string; workCount: number; storeSlugs: StoreSlug[]; nameEn?: string };

/** サーバーが返す順 (canonical_name 順) に並んだ 3 人 */
const ACTORS: Row[] = [
  { slug: "a", workCount: 1, storeSlugs: ["dlsite"] },
  { slug: "b", workCount: 5, storeSlugs: ["audible", "pokedora"] },
  { slug: "c", workCount: 5, storeSlugs: ["dlsite", "audible"] },
];

/** 英語表記つき。AniList の fullName と同じく名が先に来る */
const EN_ACTORS: Row[] = [
  { slug: "ueda", workCount: 1, storeSlugs: ["dlsite"], nameEn: "Reina Ueda" },
  { slug: "hikasa", workCount: 2, storeSlugs: ["audible"], nameEn: "Youko Hikasa" },
  { slug: "yukana", workCount: 3, storeSlugs: ["dlsite"], nameEn: "Yukana" },
  { slug: "noname", workCount: 4, storeSlugs: ["dlsite"] },
];

const slugs = (rows: Row[]) => rows.map((row) => row.slug);

describe("arrangeActors", () => {
  test("既定は作品数の多い順", () => {
    expect(
      slugs(
        arrangeActors(ACTORS, {
          sort: DEFAULT_ACTOR_SORT,
          store: null,
          initial: null,
          locale: "ja",
        }),
      ),
    ).toEqual(["b", "c", "a"]);
  });

  test("日本語表示の名前順ではサーバーが返した順のまま", () => {
    expect(
      slugs(arrangeActors(ACTORS, { sort: "name", store: null, initial: null, locale: "ja" })),
    ).toEqual(["a", "b", "c"]);
  });

  test("作品数の多い順では作品数の多い声優が先に来る", () => {
    expect(
      slugs(arrangeActors(ACTORS, { sort: "workCount", store: null, initial: null, locale: "ja" })),
    ).toEqual(["b", "c", "a"]);
  });

  /** 同数のたびに並びが入れ替わると、操作するたびに別の画面に見える */
  test("作品数が同じなら名前順のまま残る", () => {
    const arranged = arrangeActors(ACTORS, {
      sort: "workCount",
      store: null,
      initial: null,
      locale: "ja",
    });
    expect(slugs(arranged).slice(0, 2)).toEqual(["b", "c"]);
  });

  test("ストアを選ぶとそのストアに作品がある声優だけになる", () => {
    expect(
      slugs(arrangeActors(ACTORS, { sort: "name", store: "dlsite", initial: null, locale: "ja" })),
    ).toEqual(["a", "c"]);
    expect(
      slugs(
        arrangeActors(ACTORS, { sort: "name", store: "pokedora", initial: null, locale: "ja" }),
      ),
    ).toEqual(["b"]);
  });

  test("絞り込んだ結果が 0 人になることもある", () => {
    const onlyDlsite: Row[] = [{ slug: "a", workCount: 1, storeSlugs: ["dlsite"] }];
    expect(
      arrangeActors(onlyDlsite, { sort: "name", store: "audible", initial: null, locale: "ja" }),
    ).toEqual([]);
  });

  test("絞り込んでから並べ替える", () => {
    expect(
      slugs(
        arrangeActors(ACTORS, { sort: "workCount", store: "dlsite", initial: null, locale: "ja" }),
      ),
    ).toEqual(["c", "a"]);
  });

  test("渡された配列を書き換えない", () => {
    const before = slugs(ACTORS);
    arrangeActors(ACTORS, { sort: "workCount", store: null, initial: null, locale: "ja" });
    expect(slugs(ACTORS)).toEqual(before);
  });
});

describe("arrangeActors (英語表示)", () => {
  /** 「上田麗奈」は U、「日笠陽子」は H。姓で引けなければ英語話者には手がかりにならない */
  test("名前順はローマ字の姓のアルファベット順", () => {
    expect(
      slugs(arrangeActors(EN_ACTORS, { sort: "name", store: null, initial: null, locale: "en" })),
    ).toEqual(["hikasa", "ueda", "yukana", "noname"]);
  });

  test("ローマ字を持たない声優も名前順の一覧に残る", () => {
    const arranged = arrangeActors(EN_ACTORS, {
      sort: "name",
      store: null,
      initial: null,
      locale: "en",
    });
    expect(slugs(arranged)).toContain("noname");
  });

  test("大文字と小文字で順が変わらない", () => {
    const rows: Row[] = [
      { slug: "upper", workCount: 1, storeSlugs: ["dlsite"], nameEn: "Taro ANDO" },
      { slug: "lower", workCount: 1, storeSlugs: ["dlsite"], nameEn: "Jiro amano" },
    ];
    expect(
      slugs(arrangeActors(rows, { sort: "name", store: null, initial: null, locale: "en" })),
    ).toEqual(["lower", "upper"]);
  });

  test("作品数の多い順は表示言語で変わらない", () => {
    const ja = arrangeActors(EN_ACTORS, {
      sort: "workCount",
      store: null,
      initial: null,
      locale: "ja",
    });
    const en = arrangeActors(EN_ACTORS, {
      sort: "workCount",
      store: null,
      initial: null,
      locale: "en",
    });
    expect(slugs(en)).toEqual(slugs(ja));
    expect(slugs(en)).toEqual(["noname", "yukana", "hikasa", "ueda"]);
  });

  test("頭文字を選ぶとその文字で始まる姓の声優だけが残る", () => {
    expect(
      slugs(arrangeActors(EN_ACTORS, { sort: "name", store: null, initial: "U", locale: "en" })),
    ).toEqual(["ueda"]);
  });

  test("頭文字の絞り込みは作品数の多い順でも効く", () => {
    expect(
      slugs(
        arrangeActors(EN_ACTORS, { sort: "workCount", store: null, initial: "Y", locale: "en" }),
      ),
    ).toEqual(["yukana"]);
  });

  test("頭文字とストアは同時に効く", () => {
    expect(
      slugs(
        arrangeActors(EN_ACTORS, { sort: "name", store: "audible", initial: "H", locale: "en" }),
      ),
    ).toEqual(["hikasa"]);
    expect(
      arrangeActors(EN_ACTORS, { sort: "name", store: "dlsite", initial: "H", locale: "en" }),
    ).toEqual([]);
  });

  /** 日本語表示の名前順は漢字表記の順 (サーバーが返した順) のまま。ローマ字の有無で変わらない */
  test("日本語表示の名前順はローマ字を持つ声優でも並び替えない", () => {
    expect(
      slugs(arrangeActors(EN_ACTORS, { sort: "name", store: null, initial: null, locale: "ja" })),
    ).toEqual(slugs(EN_ACTORS));
  });
});

describe("availableInitials", () => {
  test("英語表示ではローマ字の姓の頭文字をアルファベット順に返す", () => {
    expect(availableInitials(EN_ACTORS, { store: null, locale: "en" })).toEqual(["H", "U", "Y"]);
  });

  test("日本語表示では何も返さない", () => {
    expect(availableInitials(EN_ACTORS, { store: null, locale: "ja" })).toEqual([]);
  });

  /** 押した結果が 0 人になる文字は出さない */
  test("ストアで絞った後に居ない文字は返さない", () => {
    expect(availableInitials(EN_ACTORS, { store: "audible", locale: "en" })).toEqual(["H"]);
  });

  test("同じ頭文字は 1 つにまとまる", () => {
    const rows: Row[] = [
      { slug: "u1", workCount: 1, storeSlugs: ["dlsite"], nameEn: "Reina Ueda" },
      { slug: "u2", workCount: 1, storeSlugs: ["dlsite"], nameEn: "Kana Ueno" },
    ];
    expect(availableInitials(rows, { store: null, locale: "en" })).toEqual(["U"]);
  });
});

describe("actorInitial", () => {
  test("姓の頭文字を大文字で返す", () => {
    expect(actorInitial({ workCount: 1, storeSlugs: [], nameEn: "Reina Ueda" }, "en")).toBe("U");
  });

  test("1 語の名義はその語の頭文字", () => {
    expect(actorInitial({ workCount: 1, storeSlugs: [], nameEn: "Yukana" }, "en")).toBe("Y");
  });

  test("ローマ字が無ければ頭文字も無い", () => {
    expect(actorInitial({ workCount: 1, storeSlugs: [] }, "en")).toBeNull();
  });

  /** 前後の空白が残ると、その文字は索引から落ちて並びも A より前に行く */
  test("前後の空白は頭文字に影響しない", () => {
    expect(actorInitial({ workCount: 1, storeSlugs: [], nameEn: " Yukana " }, "en")).toBe("Y");
    expect(actorInitial({ workCount: 1, storeSlugs: [], nameEn: " Reina Ueda" }, "en")).toBe("U");
  });

  test("空白しか無い表記は頭文字を持たない", () => {
    expect(actorInitial({ workCount: 1, storeSlugs: [], nameEn: " " }, "en")).toBeNull();
  });

  test("A-Z で始まらない表記は頭文字を持たない", () => {
    expect(actorInitial({ workCount: 1, storeSlugs: [], nameEn: "＊＊＊" }, "en")).toBeNull();
  });

  test("日本語表示では頭文字を持たない", () => {
    expect(actorInitial({ workCount: 1, storeSlugs: [], nameEn: "Reina Ueda" }, "ja")).toBeNull();
  });
});

describe("isActorSort", () => {
  test("知らない値は受け取らない", () => {
    expect(isActorSort("name")).toBe(true);
    expect(isActorSort("workCount")).toBe(true);
    expect(isActorSort("releaseDate")).toBe(false);
  });
});
