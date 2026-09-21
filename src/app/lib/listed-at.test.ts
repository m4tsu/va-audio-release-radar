import { describe, expect, test } from "vitest";
import { earliestFirstSeen, listedAt } from "@/app/lib/listed-at";
import { workListing, workSummary, workWithListings } from "@/app/test/fixtures";

describe("earliestFirstSeen", () => {
  test("複数のストアに載っていれば最も古い初出を返す", () => {
    const listings = [
      workListing({ storeSlug: "audible", firstSeenAt: "2026-09-20T00:00:00.000Z" }),
      workListing({ storeSlug: "pokedora", firstSeenAt: "2026-03-01T00:00:00.000Z" }),
      workListing({ storeSlug: "dlsite", firstSeenAt: "2026-06-10T00:00:00.000Z" }),
    ];

    expect(earliestFirstSeen(listings)).toBe("2026-03-01T00:00:00.000Z");
  });

  test("掲載が無ければ undefined", () => {
    expect(earliestFirstSeen([])).toBeUndefined();
  });
});

describe("listedAt", () => {
  test("発売日が無い作品は最も古い初出の日付を返す", () => {
    const item = workWithListings({
      work: workSummary({ releaseDate: undefined }),
      listings: [
        workListing({ storeSlug: "pokedora", firstSeenAt: "2026-03-01T15:00:00.000Z" }),
        workListing({ storeSlug: "dlsite", firstSeenAt: "2026-06-10T00:00:00.000Z" }),
      ],
    });

    expect(listedAt(item)).toBe("2026-03-01");
  });

  /** 発売日がある作品にまで出すと、日付が 2 つ並んでどちらが発売日か読めなくなる */
  test("発売日がある作品は undefined", () => {
    const item = workWithListings({ work: workSummary({ releaseDate: "2026-09-01" }) });

    expect(listedAt(item)).toBeUndefined();
  });

  test("掲載が 1 件も無ければ undefined", () => {
    const item = workWithListings({ work: workSummary({ releaseDate: undefined }), listings: [] });

    expect(listedAt(item)).toBeUndefined();
  });
});
