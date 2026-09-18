import { describe, expect, it } from "vitest";
import { getActorBySlug, listActors, searchActors, upsertActors } from "./actors";
import { ingest } from "./ingest";
import {
  giveEachActorAWork,
  HANAZAWA,
  NOW,
  payload,
  rawWork,
  setupDb,
  UEDA,
} from "./test-fixtures";

describe("upsertActors", () => {
  it("同じ id で呼び直すと上書きし、alias は重複しない", async () => {
    const db = await setupDb([]);

    await upsertActors(
      db,
      [{ ...UEDA, aliases: [{ name: "上田 麗奈", source: "manual", verified: true }] }],
      NOW,
    );
    await upsertActors(
      db,
      [
        {
          ...UEDA,
          canonicalName: "上田麗奈",
          status: "inactive",
          aliases: [{ name: "上田 麗奈", source: "manual", verified: true }],
        },
      ],
      NOW,
    );

    const actor = await getActorBySlug(db, UEDA.slug);
    expect(actor?.status).toBe("inactive");
    expect(actor?.aliases).toHaveLength(1);
  });
});

describe("searchActors", () => {
  it("空の検索語では何も返さない", async () => {
    const db = await setupDb();
    expect(await searchActors(db, "")).toEqual([]);
    expect(await searchActors(db, "   ")).toEqual([]);
  });

  it("空白の有無が違っても見つかる", async () => {
    const db = await setupDb();
    await giveEachActorAWork(db, [UEDA]);

    const results = await searchActors(db, "上田 麗奈");

    expect(results.map((actor) => actor.slug)).toEqual([UEDA.slug]);
  });

  it("部分一致でも見つかる", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await giveEachActorAWork(db, [UEDA, HANAZAWA]);

    const results = await searchActors(db, "上田");

    expect(results.map((actor) => actor.slug)).toEqual([UEDA.slug]);
  });

  it("かな読みでも見つかる", async () => {
    const db = await setupDb();
    await giveEachActorAWork(db, [UEDA]);
    expect((await searchActors(db, "うえだ")).map((actor) => actor.slug)).toEqual([UEDA.slug]);
  });

  it("alias 経由でも見つかる", async () => {
    const db = await setupDb([
      { ...UEDA, aliases: [{ name: "Reina Ueda", source: "store", verified: false }] },
    ]);
    await giveEachActorAWork(db, [UEDA]);

    const results = await searchActors(db, "Reina");

    expect(results.map((actor) => actor.slug)).toEqual([UEDA.slug]);
  });

  it("LIKE のワイルドカードは検索語として効かない", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await giveEachActorAWork(db, [UEDA, HANAZAWA]);
    expect(await searchActors(db, "%")).toEqual([]);
  });

  it("作品が 1 件も無い声優は検索結果に出さない", async () => {
    // T13: DB には AniList 由来の 2,500 人が入るが、作品の無い声優のページは作らない
    const db = await setupDb([UEDA, HANAZAWA]);
    await giveEachActorAWork(db, [UEDA]);

    expect((await searchActors(db, "上田")).map((actor) => actor.slug)).toEqual([UEDA.slug]);
    expect(await searchActors(db, "花澤")).toEqual([]);
  });
});

describe("listActors", () => {
  it("作品数つきで canonical_name 順に返す", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await giveEachActorAWork(db, [UEDA, HANAZAWA]);

    const actors = await listActors(db);

    // "上田麗奈" < "花澤香菜" (コードポイント順)
    expect(actors.map((actor) => actor.slug)).toEqual([UEDA.slug, HANAZAWA.slug]);
    expect(actors.map((actor) => actor.workCount)).toEqual([1, 1]);
  });

  it("作品が 1 件も無い声優は返さない", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingest(db, payload(), NOW);

    // payload() が credit を付けるのは 上田麗奈 だけ
    expect((await listActors(db)).map((actor) => actor.slug)).toEqual([UEDA.slug]);
  });

  it("credit の多い声優も作品数を正しく数える", async () => {
    const db = await setupDb([UEDA, HANAZAWA]);
    await ingest(
      db,
      payload({
        works: [
          rawWork({ creditedNames: ["花澤香菜"] }),
          rawWork({ storeProductId: "RJ00000002", creditedNames: ["花澤香菜"] }),
          rawWork({ storeProductId: "RJ00000003", creditedNames: ["上田麗奈"] }),
        ],
      }),
      NOW,
    );

    const byslug = new Map((await listActors(db)).map((actor) => [actor.slug, actor.workCount]));

    expect(byslug.get(HANAZAWA.slug)).toBe(2);
    expect(byslug.get(UEDA.slug)).toBe(1);
  });
});

describe("getActorBySlug", () => {
  it("居なければ undefined", async () => {
    const db = await setupDb();
    expect(await getActorBySlug(db, "nobody")).toBeUndefined();
  });

  it("作品が 1 件も無くても声優そのものは返す", async () => {
    // 一覧には出さないが、クロール履歴の確認や ingest の名寄せでは要る (T13)
    const db = await setupDb();
    expect((await getActorBySlug(db, UEDA.slug))?.id).toBe(UEDA.id);
  });

  it("alias 込みで返す", async () => {
    const db = await setupDb([
      { ...UEDA, aliases: [{ name: "上田 麗奈", source: "manual", verified: true }] },
    ]);

    const actor = await getActorBySlug(db, UEDA.slug);

    expect(actor?.canonicalName).toBe("上田麗奈");
    expect(actor?.nameKana).toBe("うえだれいな");
    expect(actor?.aliases).toEqual([
      { voiceActorId: UEDA.id, name: "上田 麗奈", source: "manual", verified: true },
    ]);
  });
});
