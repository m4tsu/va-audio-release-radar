import { describe, expect, it } from "vitest";
import { type FeedOutcome, formatOutcome } from "./daily.ts";

function outcome(partial: Partial<FeedOutcome>): FeedOutcome {
  return {
    storeSlug: "dlsite",
    status: "ok",
    listed: 0,
    sent: 0,
    warnings: [],
    ...partial,
  };
}

describe("formatOutcome", () => {
  it("一覧・新規・保存・破棄の件数を 1 行に出す", () => {
    expect(formatOutcome(outcome({ listed: 30, sent: 7, saved: 2, dropped: 5 }))).toBe(
      "DLsite ok 一覧 30 件 / 新規 7 件 / 保存 2 件 / 対象声優なしで破棄 5 件",
    );
  });

  // --dry-run では送らないので、取り込み側にしか分からない件数は出せない
  it("送っていない走行では保存と破棄を出さない", () => {
    expect(formatOutcome(outcome({ listed: 30, sent: 7 }))).toBe(
      "DLsite ok 一覧 30 件 / 新規 7 件",
    );
  });

  it("失敗した走行は理由まで出す", () => {
    expect(formatOutcome(outcome({ status: "error", reason: "新着一覧の取得に失敗" }))).toBe(
      "DLsite error 一覧 0 件 / 新規 0 件 (新着一覧の取得に失敗)",
    );
  });

  it("新着が全部既知なら empty として出す", () => {
    expect(formatOutcome(outcome({ status: "empty", listed: 30, saved: 0, dropped: 0 }))).toBe(
      "DLsite empty 一覧 30 件 / 新規 0 件 / 保存 0 件 / 対象声優なしで破棄 0 件",
    );
  });
});
