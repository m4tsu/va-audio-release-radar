import { describe, expect, it } from "vitest";
import { inspect } from "./check-name-variant-collisions.mjs";

type Rows = {
  actors: Array<{ id: string; canonical_name: string }>;
  names: Array<{ voice_actor_id: string; name: string }>;
};

function rows(actors: Array<{ id: string; canonical_name: string }>): Rows {
  return {
    actors,
    names: actors.map((actor) => ({ voice_actor_id: actor.id, name: actor.canonical_name })),
  };
}

describe("check-name-variant-collisions の inspect", () => {
  it("異体字を畳んでも別人にならなければ衝突なし", () => {
    const result = inspect(
      rows([
        { id: "va_a", canonical_name: "天崎滉平" },
        { id: "va_b", canonical_name: "日高のり子" },
        { id: "va_c", canonical_name: "斉藤壮馬" },
        { id: "va_d", canonical_name: "斎藤千和" },
      ]),
    );
    expect(result.canonicalCollisions).toEqual([]);
    expect(result.indexCollisions).toEqual([]);
  });

  it("畳んだせいで別人が同じ鍵になったら衝突として出す", () => {
    const result = inspect(
      rows([
        { id: "va_a", canonical_name: "高橋花子" },
        { id: "va_b", canonical_name: "髙橋花子" },
      ]),
    );
    expect(result.canonicalCollisions).toEqual([
      { key: "高橋花子", values: ["高橋花子", "髙橋花子"] },
    ]);
    expect(result.indexCollisions).toEqual([{ key: "高橋花子", values: ["va_a", "va_b"] }]);
  });

  it("畳む前から衝突していた同姓同名は数えない", () => {
    const result = inspect(
      rows([
        { id: "va_a", canonical_name: "上田麗奈" },
        { id: "va_b", canonical_name: "上田 麗奈" },
      ]),
    );
    expect(result.canonicalCollisions).toEqual([]);
    expect(result.indexCollisions).toEqual([]);
  });

  it("同じ声優の別表記は衝突ではない", () => {
    const result = inspect({
      actors: [{ id: "va_a", canonical_name: "天崎滉平" }],
      names: [
        { voice_actor_id: "va_a", name: "天崎滉平" },
        { voice_actor_id: "va_a", name: "天﨑滉平" },
      ],
    });
    expect(result.indexCollisions).toEqual([]);
  });
});
