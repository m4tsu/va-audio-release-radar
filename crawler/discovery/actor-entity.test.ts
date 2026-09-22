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
        nameEn: "Reina Ueda",
        anilistStaffId: 118602,
        status: "active",
        gender: "unknown",
        aliases: [
          { name: "上田 麗奈", source: "manual", verified: false },
          { name: "上田麗 奈", source: "manual", verified: false },
        ],
      },
    });
  });

  // 集計に性別が無い場合に "unknown" が入ることは、上の toEqual が見ている
  it("集計に性別があればそれをそのまま持つ", () => {
    const result = buildActorEntity(staff({ gender: "female" }));
    expect("actor" in result && result.actor.gender).toBe("female");
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

  it("取得したかなを入れる", () => {
    const result = buildActorEntity(staff(), {}, { 上田麗奈: "うえだれいな" });
    expect("actor" in result && result.actor.nameKana).toBe("うえだれいな");
  });

  it("手で書いたかなは取得した値より優先する", () => {
    const result = buildActorEntity(
      staff(),
      { 上田麗奈: { nameKana: "うえだれいな" } },
      { 上田麗奈: "うえだれな" },
    );
    expect("actor" in result && result.actor.nameKana).toBe("うえだれいな");
  });

  it("取得できなかった声優はかな無しのまま", () => {
    const result = buildActorEntity(staff(), {}, { 別の人: "べつのひと" });
    expect("actor" in result && result.actor.nameKana).toBeUndefined();
  });

  it("オーバーライドの nameEn は AniList の fullName より優先する", () => {
    const result = buildActorEntity(staff({ nativeName: "日笠陽子", fullName: "Youko Hikasa" }), {
      日笠陽子: { nameEn: "Yoko Hikasa" },
    });
    expect("actor" in result && result.actor.nameEn).toBe("Yoko Hikasa");
    // 表記を直しても slug は AniList の fullName 由来のまま。URL は後から変えられない
    expect("actor" in result && result.actor.slug).toBe("hikasa-youko");
  });

  it("手で書いた nameEn も空白を詰め、空なら AniList の表記に戻す", () => {
    const written = buildActorEntity(staff(), { 上田麗奈: { nameEn: " Reina  Ueda " } });
    expect("actor" in written && written.actor.nameEn).toBe("Reina Ueda");
    const blank = buildActorEntity(staff(), { 上田麗奈: { nameEn: "  " } });
    expect("actor" in blank && blank.actor.nameEn).toBe("Reina Ueda");
  });

  it("nameEn を書いていない声優は AniList の表記のまま", () => {
    const result = buildActorEntity(staff(), { 上田麗奈: { nameKana: "うえだれいな" } });
    expect("actor" in result && result.actor.nameEn).toBe("Reina Ueda");
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
        nameEn: "Yukana",
        anilistStaffId: 118602,
        status: "active",
        gender: "unknown",
        aliases: [],
      },
    });
  });

  it("fullName が無くても slug を書いてあれば、ローマ字なしで生成する", () => {
    const result = buildActorEntity(staff({ fullName: undefined }), {
      上田麗奈: { slug: "ueda-reina" },
    });
    expect("actor" in result && result.actor.slug).toBe("ueda-reina");
    expect("actor" in result && "nameEn" in result.actor).toBe(false);
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

  it("手書きと取得値が食い違う声優を、捨てた値と一緒に報告する", () => {
    const { kanaConflicts, actors } = buildActorEntities(
      [staff()],
      { 上田麗奈: { nameKana: "うえだれいな" } },
      { 上田麗奈: "うえだれな" },
    );
    expect(kanaConflicts).toEqual([
      { canonicalName: "上田麗奈", manual: "うえだれいな", fetched: "うえだれな" },
    ]);
    expect(actors[0]?.nameKana).toBe("うえだれいな");
  });

  it("空白とカタカナの違いだけなら食い違いにしない", () => {
    // Wikipedia は姓と名の間に空白を入れ、ラテン文字の名前にはカタカナの読みを載せる
    const { kanaConflicts } = buildActorEntities(
      [staff()],
      { 上田麗奈: { nameKana: "うえだれいな" } },
      { 上田麗奈: "ウエダ レイナ" },
    );
    expect(kanaConflicts).toEqual([]);
  });

  it("入力の並び順 (roleCount 降順) を保つ", () => {
    const { actors } = buildActorEntities([
      staff({ anilistStaffId: 95002, nativeName: "杉田智和", fullName: "Tomokazu Sugita" }),
      staff(),
    ]);
    expect(actors.map((actor) => actor.slug)).toEqual(["sugita-tomokazu", "ueda-reina"]);
  });
});

describe("オーバーライドとの突き合わせ", () => {
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
 * リポジトリに入らないので、代表的な 35 人ぶんと、slug が衝突する 2 組、
 * fullName が 1 語の例だけを fixtures に切り出してある
 */
async function readStaff(): Promise<StaffInput[]> {
  const parsed = await readJson<{ staff: StaffInput[] }>(
    path.join(FIXTURES_DIR, "anilist-staff-sample.json"),
  );
  return parsed.staff;
}
