import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORK_FILTERS,
  filterWorks,
  readWorkFilters,
  workFilterSearch,
} from "@/app/lib/work-filters";
import { workListing, workSummary, workWithListings } from "@/app/test/fixtures";

const ASMR_SOLO_DLSITE = workWithListings({
  work: workSummary({ id: "dlsite:RJ1", category: "asmr" }),
  listings: [workListing({ storeSlug: "dlsite", storeProductId: "RJ1" })],
  castSize: 1,
});

const AUDIOBOOK_LARGE_AUDIBLE = workWithListings({
  work: workSummary({ id: "audible:B01", category: "audiobook" }),
  listings: [workListing({ storeSlug: "audible", storeProductId: "B01" })],
  castSize: 6,
});

const WORKS = [ASMR_SOLO_DLSITE, AUDIOBOOK_LARGE_AUDIBLE];

const ids = (works: ReturnType<typeof filterWorks>) => works.map((item) => item.work.id);

describe("filterWorks", () => {
  it("既定ではどれも落とさない", () => {
    expect(ids(filterWorks(WORKS, DEFAULT_WORK_FILTERS))).toEqual(["dlsite:RJ1", "audible:B01"]);
  });

  it("ストア・区分・出演形態のどれでも絞れる", () => {
    expect(ids(filterWorks(WORKS, { ...DEFAULT_WORK_FILTERS, store: "audible" }))).toEqual([
      "audible:B01",
    ]);
    expect(ids(filterWorks(WORKS, { ...DEFAULT_WORK_FILTERS, category: "asmr" }))).toEqual([
      "dlsite:RJ1",
    ]);
    expect(ids(filterWorks(WORKS, { ...DEFAULT_WORK_FILTERS, appearance: "large" }))).toEqual([
      "audible:B01",
    ]);
  });

  it("軸を重ねると両方に当てはまるものだけ残る", () => {
    const filters = { store: "dlsite", category: "asmr", appearance: "large" } as const;

    expect(ids(filterWorks(WORKS, filters))).toEqual([]);
  });

  /** 同じ作品が 2 ストアに載っていれば、どちらのストアで絞っても残る */
  it("掲載が複数あるときはどれか 1 つが一致すれば残る", () => {
    const crossStore = workWithListings({
      work: workSummary({ id: "dlsite:RJ2" }),
      listings: [
        workListing({ storeSlug: "dlsite", storeProductId: "RJ2" }),
        workListing({ storeSlug: "pokedora", storeProductId: "P2" }),
      ],
    });

    expect(ids(filterWorks([crossStore], { ...DEFAULT_WORK_FILTERS, store: "pokedora" }))).toEqual([
      "dlsite:RJ2",
    ]);
  });
});

describe("readWorkFilters", () => {
  it("URL の値を読む", () => {
    expect(readWorkFilters({ store: "dlsite", category: "audiobook", appearance: "solo" })).toEqual(
      {
        store: "dlsite",
        category: "audiobook",
        appearance: "solo",
      },
    );
  });

  /** 欄が 1 つ壊れているだけで 0 件の画面になると、共有されたリンクが壊れて見える */
  it("読めない値と欠けた欄は絞り込み無しにする", () => {
    expect(readWorkFilters({ store: "zzz", category: 7 })).toEqual(DEFAULT_WORK_FILTERS);
  });
});

describe("workFilterSearch", () => {
  /** 既定値を載せると、ルーターが素の URL を書き換えて canonical と食い違う */
  it("絞っていない軸は欄ごと落とす", () => {
    expect(workFilterSearch(DEFAULT_WORK_FILTERS)).toEqual({});
    expect(workFilterSearch({ ...DEFAULT_WORK_FILTERS, category: "asmr" })).toEqual({
      category: "asmr",
    });
  });

  it("絞っている軸だけを載せる", () => {
    expect(
      workFilterSearch({ store: "audible", category: "audiobook", appearance: "solo" }),
    ).toEqual({ store: "audible", category: "audiobook", appearance: "solo" });
  });
});
