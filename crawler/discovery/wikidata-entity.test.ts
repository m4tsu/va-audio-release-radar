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
    expect(kanaClaims(ranked("wb-deprecated", "wb-deprecated"))).toEqual([]);
  });

  it("優先の主張があれば、並びが後ろでもそちらだけを読む", () => {
    // 改名した人は旧名の読みも主張として残る。並び順で選ぶと旧名を採ることがある
    expect(kanaClaims(ranked("wb-normal", "wb-preferred"))).toEqual(["あたらしいよみ"]);
  });

  it("順位が付いていなければ書かれている順に返す", () => {
    expect(kanaClaims(ranked("wb-normal", "wb-normal"))).toEqual(["ふるいよみ", "あたらしいよみ"]);
  });
});

/** P1814 を 2 件持つ項目。実物の markup を値と順位だけ変えて 2 件ぶんに削ったもの */
function ranked(firstRank: string, secondRank: string): string {
  const statement = (rank: string, value: string) => `
<div id="Q1$${value}" class="wikibase-statementview ${rank}">
<div class="wikibase-statementview-mainsnak-container">
<div class="wikibase-statementview-mainsnak" dir="auto"><div class="wikibase-snakview">
<div class="wikibase-snakview-value-container" dir="auto"><div class="wikibase-snakview-body">
<div class="wikibase-snakview-value wikibase-snakview-variation-valuesnak">${value}</div>
</div></div>
</div></div>
</div>
<div class="wikibase-statementview-qualifiers"></div>
</div>`;
  return `<!DOCTYPE html><html><body>
<div class="wikibase-statementgroupview" id="P1814" data-property-id="P1814">
<div class="wikibase-statementlistview">
<div class="wikibase-statementlistview-listview">
${statement(firstRank, "ふるいよみ")}
${statement(secondRank, "あたらしいよみ")}
</div>
</div>
</div>
</body></html>`;
}
