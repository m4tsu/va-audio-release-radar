import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CRAWLER_DIR, FIXTURES_DIR } from "../lib/paths.ts";
import {
  type ActorOverrides,
  buildActorEntities,
  buildActorEntity,
  buildAliases,
  findSlugCollisions,
  type StaffInput,
  spacedNameCandidates,
  toActorSlug,
} from "./actor-entity.ts";

function staff(overrides: Partial<StaffInput> = {}): StaffInput {
  return {
    anilistStaffId: 118602,
    nativeName: "上田麗奈",
    fullName: "Reina Ueda",
    roleCount: 40,
    ambiguous: false,
    ...overrides,
  };
}

describe("toActorSlug", () => {
  it("名-姓 を 姓-名 にして小文字化する", () => {
    expect(toActorSlug("Reina Ueda")).toBe("ueda-reina");
  });

  it("AniList のワープロ式表記をそのまま使い、長音を潰さない", () => {
    // 「ou」「uu」が長音とは限らない (井上 = Inoue) ので、機械的に潰すと別の名前を壊す
    expect(toActorSlug("Akari Kitou")).toBe("kitou-akari");
    expect(toActorSlug("Aoi Yuuki")).toBe("yuuki-aoi");
    expect(toActorSlug("Souma Saitou")).toBe("saitou-souma");
  });

  it("3 語以上なら最後の語を姓、残りを名として前から並べる", () => {
    expect(toActorSlug("Sarah Emi Bridcutt")).toBe("bridcutt-sarah-emi");
  });

  it("改行や記号が混ざっていても落とす", () => {
    expect(toActorSlug("Makoto\r\n Takahashi")).toBe("takahashi-makoto");
    expect(toActorSlug("Debi-Debi Debiru")).toBe("debiru-debidebi");
  });

  it("1 語ならその語をそのまま slug にする (ゆかな・麦人・KENN のような名義)", () => {
    expect(toActorSlug("Yukana")).toBe("yukana");
    expect(toActorSlug("Mugihito")).toBe("mugihito");
    expect(toActorSlug("KENN")).toBe("kenn");
  });

  it("記号が混ざっていても中身が残れば slug にする", () => {
    // "!" は落ちるが "kukkii" は残るので、1 語の名義として slug になる
    expect(toActorSlug("Kukkii!")).toBe("kukkii");
  });

  it("空、または記号だけで中身が残らないなら slug を作らない", () => {
    expect(toActorSlug("   ")).toBeUndefined();
    expect(toActorSlug("!!!")).toBeUndefined();
    expect(toActorSlug(undefined)).toBeUndefined();
  });
});

describe("spacedNameCandidates", () => {
  it("4 文字以上は姓を 2 文字で切った形と 3 文字で切った形を返す", () => {
    expect(spacedNameCandidates("上田麗奈")).toEqual(["上田 麗奈", "上田麗 奈"]);
  });

  it("3 文字は 1 文字切りと 2 文字切りを返す (姓が 1 文字か 2 文字かは名前からは分からない)", () => {
    expect(spacedNameCandidates("梶裕貴")).toEqual(["梶 裕貴", "梶裕 貴"]);
  });

  it("2 文字は 1 文字切りしか作れない (林勇・魚建のような名義)", () => {
    expect(spacedNameCandidates("林勇")).toEqual(["林 勇"]);
    expect(spacedNameCandidates("魚建")).toEqual(["魚 建"]);
  });

  it("1 文字以下は切る位置が無いので候補を作らない", () => {
    expect(spacedNameCandidates("麦")).toEqual([]);
  });

  it("候補は常に 2 個以下", () => {
    expect(spacedNameCandidates("五十嵐大地郎").length).toBeLessThanOrEqual(2);
  });

  it("異体字も 1 文字として数える", () => {
    expect(spacedNameCandidates("種﨑敦美")).toEqual(["種﨑 敦美", "種﨑敦 美"]);
  });
});

describe("buildAliases", () => {
  it("オーバーライドが無ければ生成候補を未検証で持つ", () => {
    expect(buildAliases("上田麗奈", undefined)).toEqual([
      { name: "上田 麗奈", source: "manual", verified: false },
      { name: "上田麗 奈", source: "manual", verified: false },
    ]);
  });

  it("検証済みの別名があればそれだけを使う", () => {
    // 梶裕貴 は姓が 1 文字なので、生成候補 (梶裕 貴) では正解に当たらない
    expect(buildAliases("梶裕貴", { aliases: ["梶 裕貴"] })).toEqual([
      { name: "梶 裕貴", source: "manual", verified: true },
    ]);
  });

  it("1 語の名義 (singleWordName) は候補を作らない", () => {
    expect(buildAliases("ゆかな", undefined, true)).toEqual([]);
  });

  it("1 語の名義でもオーバーライドの検証済み別名は使う", () => {
    expect(buildAliases("ゆかな", { aliases: ["ゆか な"] }, true)).toEqual([
      { name: "ゆか な", source: "manual", verified: true },
    ]);
  });
});

describe("buildActorEntity", () => {
  it("id は va_{slug}、canonicalName は nativeName、status は active", () => {
    const result = buildActorEntity(staff());
    expect(result).toEqual({
      actor: {
        id: "va_ueda-reina",
        slug: "ueda-reina",
        canonicalName: "上田麗奈",
        anilistStaffId: 118602,
        status: "active",
        aliases: [
          { name: "上田 麗奈", source: "manual", verified: false },
          { name: "上田麗 奈", source: "manual", verified: false },
        ],
      },
    });
  });

  it("nativeName の前後の空白を落とす", () => {
    const result = buildActorEntity(staff({ nativeName: "茶風林 ", fullName: "Chafuurin Ando" }));
    expect("actor" in result && result.actor.canonicalName).toBe("茶風林");
  });

  it("オーバーライドの nameKana と別名をマージする", () => {
    const result = buildActorEntity(staff(), {
      上田麗奈: { nameKana: "うえだれいな", aliases: ["上田 麗奈"] },
    });
    expect("actor" in result && result.actor.nameKana).toBe("うえだれいな");
    expect("actor" in result && result.actor.aliases).toEqual([
      { name: "上田 麗奈", source: "manual", verified: true },
    ]);
  });

  it("オーバーライドの slug は生成規則より優先する", () => {
    const result = buildActorEntity(staff(), { 上田麗奈: { slug: "ueda-reina-118602" } });
    expect("actor" in result && result.actor.slug).toBe("ueda-reina-118602");
    expect("actor" in result && result.actor.id).toBe("va_ueda-reina-118602");
  });

  it("ambiguous な声優は除外する", () => {
    expect(buildActorEntity(staff({ ambiguous: true }))).toEqual({
      excluded: {
        anilistStaffId: 118602,
        nativeName: "上田麗奈",
        fullName: "Reina Ueda",
        reason: "ambiguous",
      },
    });
  });

  it("fullName が 1 語ならその語を slug にし、別名候補は作らない", () => {
    const result = buildActorEntity(staff({ nativeName: "ゆかな", fullName: "Yukana" }));
    expect(result).toEqual({
      actor: {
        id: "va_yukana",
        slug: "yukana",
        canonicalName: "ゆかな",
        anilistStaffId: 118602,
        status: "active",
        aliases: [],
      },
    });
  });

  it("fullName が無ければ除外する", () => {
    const result = buildActorEntity(staff({ fullName: undefined }));
    expect("excluded" in result && result.excluded.reason).toBe("no-slug");
  });

  it("nativeName が空なら除外する", () => {
    const result = buildActorEntity(staff({ nativeName: "  " }));
    expect("excluded" in result && result.excluded.reason).toBe("no-native-name");
  });
});

describe("findSlugCollisions", () => {
  it("同じ slug の声優をまとめて返す", () => {
    const { actors } = buildActorEntities([
      staff({ anilistStaffId: 344277, nativeName: "三波春香", fullName: "Haruka Minami" }),
      staff({ anilistStaffId: 351376, nativeName: "南波遥海", fullName: "Haruka Minami" }),
    ]);

    expect(findSlugCollisions(actors)).toEqual([
      {
        slug: "minami-haruka",
        members: [
          { anilistStaffId: 344277, canonicalName: "三波春香" },
          { anilistStaffId: 351376, canonicalName: "南波遥海" },
        ],
      },
    ]);
  });

  it("オーバーライドで片方の slug を変えれば衝突しない", () => {
    const { collisions } = buildActorEntities(
      [
        staff({ anilistStaffId: 344277, nativeName: "三波春香", fullName: "Haruka Minami" }),
        staff({ anilistStaffId: 351376, nativeName: "南波遥海", fullName: "Haruka Minami" }),
      ],
      { 南波遥海: { slug: "minami-haruka-351376" } },
    );
    expect(collisions).toEqual([]);
  });
});

describe("buildActorEntities", () => {
  it("使われなかったオーバーライドのキーを報告する", () => {
    const { unusedOverrideKeys } = buildActorEntities([staff()], {
      上田麗奈: { nameKana: "うえだれいな" },
      居ない人: { nameKana: "いないひと" },
    });
    expect(unusedOverrideKeys).toEqual(["居ない人"]);
  });

  it("入力の並び順 (roleCount 降順) を保つ", () => {
    const { actors } = buildActorEntities([
      staff({ anilistStaffId: 95002, nativeName: "杉田智和", fullName: "Tomokazu Sugita" }),
      staff(),
    ]);
    expect(actors.map((actor) => actor.slug)).toEqual(["sugita-tomokazu", "ueda-reina"]);
  });
});

/**
 * 手書きシード 35 人の slug が生成規則でどう変わるかを固定する (T13 の決定)。
 *
 * 25 人はそのまま、10 人は長音の扱いだけが変わる (kito → kitou など)。
 * ここが崩れたら生成規則か AniList のデータが変わったということなので、
 * URL が黙って入れ替わる前に気づけるようにする
 */
describe("手書きシードとの突き合わせ", () => {
  /** 長音違いで slug が変わる 10 人。左が手書き、右が生成 */
  const RENAMED: Array<[canonicalName: string, before: string, after: string]> = [
    ["鬼頭明里", "kito-akari", "kitou-akari"],
    ["悠木碧", "yuki-aoi", "yuuki-aoi"],
    ["東山奈央", "toyama-nao", "touyama-nao"],
    ["大西沙織", "onishi-saori", "oonishi-saori"],
    ["伊藤美来", "ito-miku", "itou-miku"],
    ["日笠陽子", "hikasa-yoko", "hikasa-youko"],
    ["梶裕貴", "kaji-yuki", "kaji-yuuki"],
    ["中村悠一", "nakamura-yuichi", "nakamura-yuuichi"],
    ["斉藤壮馬", "saito-soma", "saitou-souma"],
    ["小野賢章", "ono-kensho", "ono-kenshou"],
  ];

  it("25 人は一致し、10 人は長音の扱いだけが変わる", async () => {
    const seeds = await readJson<
      Array<{ slug: string; canonicalName: string; anilistStaffId: number }>
    >(path.join(CRAWLER_DIR, "actors.json"));
    const overrides = await readJson<ActorOverrides>(
      path.join(CRAWLER_DIR, "actors-overrides.json"),
    );
    const { actors } = buildActorEntities(await readStaff(), overrides);
    const generatedById = new Map(actors.map((actor) => [actor.anilistStaffId, actor]));

    const unchanged: string[] = [];
    const renamed: Array<[string, string, string]> = [];
    for (const seed of seeds) {
      const generated = generatedById.get(seed.anilistStaffId);
      expect(generated, `${seed.canonicalName} が生成結果に居ない`).toBeDefined();
      if (generated === undefined) continue;
      if (generated.slug === seed.slug) unchanged.push(seed.slug);
      else renamed.push([seed.canonicalName, seed.slug, generated.slug]);
    }

    expect(seeds).toHaveLength(35);
    expect(unchanged).toHaveLength(25);
    expect(renamed.sort()).toEqual([...RENAMED].sort());
  });

  it("手書きの nameKana と検証済み別名はオーバーライド経由で全員に引き継がれる", async () => {
    const seeds = await readJson<
      Array<{ canonicalName: string; nameKana?: string; anilistStaffId: number }>
    >(path.join(CRAWLER_DIR, "actors.json"));
    const overrides = await readJson<ActorOverrides>(
      path.join(CRAWLER_DIR, "actors-overrides.json"),
    );
    const { actors } = buildActorEntities(await readStaff(), overrides);
    const generatedById = new Map(actors.map((actor) => [actor.anilistStaffId, actor]));

    for (const seed of seeds) {
      const generated = generatedById.get(seed.anilistStaffId);
      expect(generated?.nameKana, seed.canonicalName).toBe(seed.nameKana);
      expect(
        generated?.aliases.every((alias) => alias.verified),
        seed.canonicalName,
      ).toBe(true);
    }
  });

  it("同じローマ字になる別人はオーバーライドで解決済み", async () => {
    const overrides = await readJson<ActorOverrides>(
      path.join(CRAWLER_DIR, "actors-overrides.json"),
    );
    const { collisions } = buildActorEntities(await readStaff(), overrides);
    expect(collisions).toEqual([]);
  });
});

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

/**
 * テスト用の staff 抜粋。実データ (`crawler/.cache/discovery/anilist-staff.json`) は
 * リポジトリに入らないので、手書きシード 35 人ぶんと、slug が衝突する 2 組、
 * fullName が 1 語の例だけを fixtures に切り出してある
 */
async function readStaff(): Promise<StaffInput[]> {
  const parsed = await readJson<{ staff: StaffInput[] }>(
    path.join(FIXTURES_DIR, "anilist-staff-sample.json"),
  );
  return parsed.staff;
}
