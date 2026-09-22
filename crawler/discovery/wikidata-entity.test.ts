import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES_DIR } from "../lib/paths.ts";
import { entityUrl, isEntityId, kanaClaims } from "./wikidata-entity.ts";

function fixture(itemId: string): string {
  return readFileSync(path.join(FIXTURES_DIR, `wikidata-${itemId}.html`), "utf8");
}

describe("entityUrl / isEntityId", () => {
  it("URL にクエリパラメータを付けない", () => {
    expect(entityUrl("Q3546378")).toBe("https://www.wikidata.org/wiki/Q3546378");
  });

  it("Q + 数字だけを項目 id として認める", () => {
    expect(isEntityId("Q3546378")).toBe(true);
    expect(isEntityId("Special:EntityData/Q3546378")).toBe(false);
    expect(isEntityId("P1814")).toBe(false);
  });
});

describe("kanaClaims", () => {
  it("単独の主張として置かれた P1814 を取る", () => {
    expect(kanaClaims(fixture("Q3546378"))).toEqual(["やまじ かずひろ"]);
  });

  it("限定子の P1814 は取らない", () => {
    // Q2462286 は P1559 (name in native language) の限定子にも同じ読みを持つ。
    // 限定子まで拾うと、P2562 (married name) を持つ項目で結婚後の姓の読みが混ざる
    expect(kanaClaims(fixture("Q2462286"))).toEqual(["むぎひと"]);
  });

  it("P1814 を持たない項目からは何も取らない", () => {
    expect(kanaClaims("<html><body><div>name in kana</div></body></html>")).toEqual([]);
  });

  it("取り下げられた主張は読まない", () => {
    expect(kanaClaims(deprecatedOnly)).toEqual([]);
  });
});

/** 取り下げ済み (`wb-deprecated`) の主張しか持たない項目。実物の markup を 1 件ぶんに削ったもの */
const deprecatedOnly = `<!DOCTYPE html><html><body>
<div class="wikibase-statementgroupview" id="P1814" data-property-id="P1814">
<div class="wikibase-statementlistview">
<div class="wikibase-statementlistview-listview">
<div id="Q1$a" class="wikibase-statementview wb-deprecated">
<div class="wikibase-statementview-mainsnak-container">
<div class="wikibase-statementview-mainsnak" dir="auto"><div class="wikibase-snakview">
<div class="wikibase-snakview-value-container" dir="auto"><div class="wikibase-snakview-body">
<div class="wikibase-snakview-value wikibase-snakview-variation-valuesnak">まちがったよみ</div>
</div></div>
</div></div>
</div>
</div>
</div>
</div>
</div>
</body></html>`;
