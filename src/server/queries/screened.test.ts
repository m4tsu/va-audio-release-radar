import { describe, expect, it } from "vitest";
import { createMigratedTestDb } from "../db/test-db";
import { clearScreened, recordScreened, screenedStoreProductIds } from "./screened";

const NOW = "2026-09-21T00:00:00.000Z";
const LATER = "2026-09-22T00:00:00.000Z";

describe("recordScreened", () => {
  it("覚えた商品 ID をストアごとに返す", async () => {
    const db = await createMigratedTestDb();

    await recordScreened(db, "dlsite", ["RJ1", "RJ2"], NOW);
    await recordScreened(db, "pokedora", ["1"], NOW);

    expect((await screenedStoreProductIds(db, "dlsite")).sort()).toEqual(["RJ1", "RJ2"]);
    expect(await screenedStoreProductIds(db, "pokedora")).toEqual(["1"]);
    // ストアが違えば同じ ID でも別物として扱う
    expect(await screenedStoreProductIds(db, "audible")).toEqual([]);
  });

  it("同じ商品を 2 度覚えても 1 件のまま", async () => {
    const db = await createMigratedTestDb();

    await recordScreened(db, "dlsite", ["RJ1"], NOW);
    await recordScreened(db, "dlsite", ["RJ1", "RJ2"], LATER);

    expect((await screenedStoreProductIds(db, "dlsite")).sort()).toEqual(["RJ1", "RJ2"]);
  });

  it("同じ呼び出しの中で重複していても落ちない", async () => {
    const db = await createMigratedTestDb();

    await recordScreened(db, "dlsite", ["RJ1", "RJ1"], NOW);

    expect(await screenedStoreProductIds(db, "dlsite")).toEqual(["RJ1"]);
  });

  it("0 件なら何もしない", async () => {
    const db = await createMigratedTestDb();

    await recordScreened(db, "dlsite", [], NOW);

    expect(await screenedStoreProductIds(db, "dlsite")).toEqual([]);
  });

  // D1 の bound parameter 上限を超えないことを、件数で踏んでおく
  it("上限を超える件数でも入る", async () => {
    const db = await createMigratedTestDb();
    const ids = Array.from({ length: 200 }, (_value, index) => `RJ${index}`);

    await recordScreened(db, "dlsite", ids, NOW);

    expect(await screenedStoreProductIds(db, "dlsite")).toHaveLength(200);
  });
});

describe("clearScreened", () => {
  it("全ストアの判断を捨て、捨てた件数を返す", async () => {
    const db = await createMigratedTestDb();
    await recordScreened(db, "dlsite", ["RJ1", "RJ2"], NOW);
    await recordScreened(db, "audible", ["B1"], NOW);

    expect(await clearScreened(db)).toBe(3);
    expect(await screenedStoreProductIds(db, "dlsite")).toEqual([]);
    expect(await screenedStoreProductIds(db, "audible")).toEqual([]);
  });

  it("空でも落ちない", async () => {
    const db = await createMigratedTestDb();

    expect(await clearScreened(db)).toBe(0);
  });
});
