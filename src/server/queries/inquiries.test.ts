import { describe, expect, it } from "vitest";
import { createMigratedTestDb } from "../db/test-db";
import { listInquiries, saveInquiry } from "./inquiries";

/** 基準時刻。受け取った時刻を引数で固定し、並びの検証を実行時刻に依存させない */
const NOW = "2026-09-18T00:00:00.000Z";
const MINUTE_MS = 60 * 1000;

function at(offsetMs: number): string {
  return new Date(Date.parse(NOW) + offsetMs).toISOString();
}

describe("saveInquiry", () => {
  it("種別・本文・連絡先と受け取った時刻を残す", async () => {
    const db = await createMigratedTestDb();

    const saved = await saveInquiry(
      db,
      { kind: "bug", body: "声優ページが開けない", contact: "user@example.com" },
      NOW,
    );

    expect(saved).toEqual({
      id: expect.any(Number),
      kind: "bug",
      body: "声優ページが開けない",
      contact: "user@example.com",
      receivedAt: NOW,
    });
    expect(await listInquiries(db)).toEqual([saved]);
  });

  /** 連絡先は任意。未記入で届いた行も読み出せる */
  it("連絡先が無くても保存できる", async () => {
    const db = await createMigratedTestDb();

    const saved = await saveInquiry(db, { kind: "request", body: "ストアを増やしてほしい" }, NOW);

    expect(saved.contact).toBeUndefined();
    expect(await listInquiries(db)).toEqual([saved]);
  });

  it("同じ内容を 2 回送っても別の行になる", async () => {
    const db = await createMigratedTestDb();
    const first = await saveInquiry(db, { kind: "other", body: "同じ文面" }, NOW);

    const second = await saveInquiry(db, { kind: "other", body: "同じ文面" }, at(MINUTE_MS));

    expect(second.id).not.toBe(first.id);
    expect(await listInquiries(db)).toHaveLength(2);
  });
});

describe("listInquiries", () => {
  it("新しい順に返す", async () => {
    const db = await createMigratedTestDb();
    await saveInquiry(db, { kind: "request", body: "古い" }, NOW);
    await saveInquiry(db, { kind: "bug", body: "新しい" }, at(2 * MINUTE_MS));
    await saveInquiry(db, { kind: "other", body: "中間" }, at(MINUTE_MS));

    const rows = await listInquiries(db);

    expect(rows.map((row) => row.body)).toEqual(["新しい", "中間", "古い"]);
  });

  /** 同じ時刻に届いた 2 件の並びが実行ごとに入れ替わらないことを確かめる */
  it("受け取った時刻が同じなら後から入った方を先に出す", async () => {
    const db = await createMigratedTestDb();
    const first = await saveInquiry(db, { kind: "request", body: "先" }, NOW);
    const second = await saveInquiry(db, { kind: "request", body: "後" }, NOW);

    const rows = await listInquiries(db);

    expect(rows.map((row) => row.id)).toEqual([second.id, first.id]);
  });

  it("上限を超える件数は返さない", async () => {
    const db = await createMigratedTestDb();
    for (let index = 0; index < 3; index += 1) {
      await saveInquiry(db, { kind: "other", body: `${index}` }, at(index * MINUTE_MS));
    }

    const rows = await listInquiries(db, 2);

    expect(rows.map((row) => row.body)).toEqual(["2", "1"]);
  });

  /** 管理画面が 2 ページ目を出すときの読み方。飛ばした先から続きが返る */
  it("飛ばした件数のぶんだけ後ろから返す", async () => {
    const db = await createMigratedTestDb();
    for (let index = 0; index < 4; index += 1) {
      await saveInquiry(db, { kind: "other", body: `${index}` }, at(index * MINUTE_MS));
    }

    const rows = await listInquiries(db, 2, 2);

    expect(rows.map((row) => row.body)).toEqual(["1", "0"]);
  });

  it("飛ばした先に行が無ければ空配列", async () => {
    const db = await createMigratedTestDb();
    await saveInquiry(db, { kind: "other", body: "1 件だけ" }, NOW);

    expect(await listInquiries(db, 2, 2)).toEqual([]);
  });

  it("1 件も無ければ空配列", async () => {
    const db = await createMigratedTestDb();

    expect(await listInquiries(db)).toEqual([]);
  });
});
