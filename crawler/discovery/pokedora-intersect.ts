import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeName } from "../../src/domain/normalize.ts";
import { parseSearchHtml } from "../adapters/audible.ts";
import { CACHE_DIR, CRAWLER_DIR, SNAPSHOT_DIR } from "../lib/paths.ts";
import type { StaffRecord } from "./anilist.ts";
import type { DlsiteWorkRecord } from "./intersect.ts";
import { describeDistribution } from "./intersect.ts";
import type { PokedoraTagRecord, PokedoraTagsCache } from "./pokedora-tags.ts";
import { summarizeRecords } from "./pokedora-tags.ts";

/**
 * ポケドラの声優タグ辞書 (段階 1 の成果) と AniList の 2,569 人を突き合わせ、
 * 交差の規模と段階 3・4 の所要時間を数える (ポケドラの取得手順の段階 2)。
 *
 *   node crawler/discovery/pokedora-intersect.ts
 *
 * ネットワークには一切出ない。DB にも書かない。
 * 入力はすべて crawler/.cache の既存キャッシュで、出力は docs/research の 1 ファイル
 */

const DISCOVERY_DIR = path.join(CACHE_DIR, "discovery");
const TAGS_JSON = path.join(DISCOVERY_DIR, "pokedora-tags.json");
const ANILIST_STAFF_JSON = path.join(DISCOVERY_DIR, "anilist-staff.json");
const DLSITE_WORKS_JSON = path.join(DISCOVERY_DIR, "dlsite-works.json");
const AUDIBLE_SNAPSHOT_DIR = path.join(SNAPSHOT_DIR, "audible");
const REPORT_PATH = path.resolve(
  CRAWLER_DIR,
  "..",
  "docs/research/pokedora-intersection-2026-09-18.md",
);

/** 段階 3・4 の 1 リクエストあたりの間隔。fetch.ts のポケドラ設定と同じ */
const REQUEST_INTERVAL_SECONDS = 5;
/** 段階 3 で 1 声優あたり引くページ数 (一般 + BL) */
const PAGES_PER_ACTOR = 2;
/** スナップショットを読み直すときの取得日時。作品の有無を数えるだけなので値は結果に影響しない */
const FETCHED_AT = "2026-09-18";
const TOP_ROWS = 40;
const POKEDORA_ONLY_ROWS = 20;

// --- 声優 1 人ぶんの形 -----------------------------------------------------

export type PokedoraActor = {
  tagId: number;
  name: string;
  normalized: string;
  men: number;
  bl: number;
  adt: number;
  adtBl: number;
  /** 取得対象 (一般 + BL) の件数。オトナ向け 2 ストアは §14 で対象外 */
  target: number;
};

/** 名前と件数が両方そろった記録だけを声優として扱う */
export function toActors(records: readonly PokedoraTagRecord[]): PokedoraActor[] {
  const actors: PokedoraActor[] = [];
  for (const record of records) {
    if (record.status !== "ok" || record.name === undefined) continue;
    const counts = record.counts ?? { men: 0, bl: 0, adt: 0, "adt-bl": 0 };
    actors.push({
      tagId: record.tagId,
      name: record.name,
      normalized: normalizeName(record.name),
      men: counts.men,
      bl: counts.bl,
      adt: counts.adt,
      adtBl: counts["adt-bl"],
      target: counts.men + counts.bl,
    });
  }
  return actors;
}

/**
 * 正規化後の名前でまとめる。ポケドラ側で同じ名前に複数の tag_id が付いていることがあり、
 * その人は「どの tag_id を引けばよいか」を辞書だけでは決められない
 */
export function groupByNormalizedName(
  actors: readonly PokedoraActor[],
): Map<string, PokedoraActor[]> {
  const grouped = new Map<string, PokedoraActor[]>();
  for (const actor of actors) {
    const bucket = grouped.get(actor.normalized);
    if (bucket === undefined) grouped.set(actor.normalized, [actor]);
    else bucket.push(actor);
  }
  return grouped;
}

// --- 交差 ------------------------------------------------------------------

/** Audible は 36 人ぶんのスナップショットしかないので、未調査を偽と混ぜない */
export type AudiblePresence = "yes" | "no" | "unknown";

export type PokedoraIntersectionRow = {
  name: string;
  /** 同名の tag_id が複数あるときは全部入る。先頭は target が最大のもの */
  tagIds: number[];
  men: number;
  bl: number;
  target: number;
  adtTotal: number;
  anilistStaffId: number;
  anilistRoleCount: number;
  /** AniList 側に同名の別 staff が居る */
  anilistAmbiguous: boolean;
  dlsite: boolean;
  audible: AudiblePresence;
};

export type PokedoraIntersectionResult = {
  rows: PokedoraIntersectionRow[];
  /** AniList に無い名前のポケドラ声優。target の多い順 */
  pokedoraOnly: PokedoraActor[];
  /** ポケドラ側で同じ名前に複数の tag_id が付いていた組 */
  duplicateNames: { name: string; actors: PokedoraActor[] }[];
};

export function intersect(options: {
  actors: readonly PokedoraActor[];
  staff: readonly StaffRecord[];
  dlsiteNames: ReadonlySet<string>;
  audibleByName: ReadonlyMap<string, boolean>;
}): PokedoraIntersectionResult {
  const staffByName = new Map<string, StaffRecord>();
  for (const person of options.staff) {
    if (person.nativeName === "") continue;
    const key = normalizeName(person.nativeName);
    const existing = staffByName.get(key);
    // 同名が複数居るときは出演の多いほうを代表にする。ambiguous フラグで注意は残す
    if (existing === undefined || existing.roleCount < person.roleCount)
      staffByName.set(key, person);
  }

  const grouped = groupByNormalizedName(options.actors);
  const rows: PokedoraIntersectionRow[] = [];
  const pokedoraOnly: PokedoraActor[] = [];
  const duplicateNames: { name: string; actors: PokedoraActor[] }[] = [];

  for (const [normalized, bucket] of grouped) {
    const sorted = [...bucket].sort((a, b) => b.target - a.target);
    if (sorted.length > 1) {
      duplicateNames.push({ name: sorted[0]?.name ?? normalized, actors: sorted });
    }
    const person = staffByName.get(normalized);
    if (person === undefined) {
      // 同名タグが複数あっても「ポケドラにしか居ない人」としては 1 人。件数は合算する
      const merged = sorted[0];
      if (merged === undefined) continue;
      pokedoraOnly.push({
        ...merged,
        men: sorted.reduce((sum, actor) => sum + actor.men, 0),
        bl: sorted.reduce((sum, actor) => sum + actor.bl, 0),
        adt: sorted.reduce((sum, actor) => sum + actor.adt, 0),
        adtBl: sorted.reduce((sum, actor) => sum + actor.adtBl, 0),
        target: sorted.reduce((sum, actor) => sum + actor.target, 0),
      });
      continue;
    }
    rows.push({
      name: sorted[0]?.name ?? person.nativeName,
      tagIds: sorted.map((actor) => actor.tagId),
      men: sorted.reduce((sum, actor) => sum + actor.men, 0),
      bl: sorted.reduce((sum, actor) => sum + actor.bl, 0),
      target: sorted.reduce((sum, actor) => sum + actor.target, 0),
      adtTotal: sorted.reduce((sum, actor) => sum + actor.adt + actor.adtBl, 0),
      anilistStaffId: person.anilistStaffId,
      anilistRoleCount: person.roleCount,
      anilistAmbiguous: person.ambiguous,
      dlsite: options.dlsiteNames.has(normalized),
      audible: toAudiblePresence(options.audibleByName.get(normalized)),
    });
  }

  rows.sort((a, b) => b.target - a.target || a.name.localeCompare(b.name, "ja"));
  pokedoraOnly.sort((a, b) => b.target - a.target || a.name.localeCompare(b.name, "ja"));
  duplicateNames.sort((a, b) => b.actors.length - a.actors.length);
  return { rows, pokedoraOnly, duplicateNames };
}

function toAudiblePresence(value: boolean | undefined): AudiblePresence {
  if (value === undefined) return "unknown";
  return value ? "yes" : "no";
}

// --- 入力の読み込み --------------------------------------------------------

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

/**
 * DLsite 側の声優名。発見スパイクで取った直近 2,085 作品の `voice_by` なので、
 * 「DLsite に居る声優の全集合」ではなく直近に作品があった人の集合である点に注意
 */
export function dlsiteVoiceNames(works: readonly DlsiteWorkRecord[]): Set<string> {
  const names = new Set<string>();
  for (const work of works) {
    for (const name of work.voiceNames ?? []) names.add(normalizeName(name));
  }
  return names;
}

/**
 * 発見スパイクが残した Audible の検索結果 HTML から、名前ごとの作品有無を復元する。
 * 新たにネットワークへ出ないためにスナップショットを読む。
 *
 * 件数の見出し (`parseTotalCount`) ではなく実際の作品要素を数えるのは、結果が 1 件のときに
 * 見出しが出ず undefined になるため。それを 0 件と読むと「作品あり」を取りこぼす。
 *
 * **このスナップショット群からは「作品が無い」は導けない。** 検索が空振りしたときは
 * `/no-search-results` へ 302 で飛ばされてファイルが残らないので、ここに在るのは当たりだけである
 */
async function readAudiblePresence(): Promise<Map<string, boolean>> {
  const presence = new Map<string, boolean>();
  let files: string[];
  try {
    files = await readdir(AUDIBLE_SNAPSHOT_DIR);
  } catch {
    return presence;
  }
  for (const file of files) {
    const name = /^search-(.+)\.html$/.exec(file)?.[1];
    if (name === undefined) continue;
    const html = await readFile(path.join(AUDIBLE_SNAPSHOT_DIR, file), "utf8");
    presence.set(normalizeName(name), parseSearchHtml(html, FETCHED_AT).works.length > 0);
  }
  return presence;
}

// --- 報告 ------------------------------------------------------------------

function formatHours(seconds: number): string {
  const hours = seconds / 3600;
  return hours < 1 ? `${Math.round(seconds / 60)} 分` : `${hours.toFixed(1)} 時間`;
}

function formatAudible(value: AudiblePresence): string {
  if (value === "yes") return "○";
  return value === "no" ? "×" : "未調査";
}

export function buildReport(input: {
  cache: PokedoraTagsCache;
  result: PokedoraIntersectionResult;
  staffCount: number;
  dlsiteWorkCount: number;
  dlsiteNameCount: number;
  audibleProbedCount: number;
}): string {
  const { cache, result } = input;
  const summary = summarizeRecords(cache.records);
  const targets = result.rows.map((row) => row.target);
  const distribution = describeDistribution(targets);
  const menSum = result.rows.reduce((sum, row) => sum + row.men, 0);
  const blSum = result.rows.reduce((sum, row) => sum + row.bl, 0);
  const adtSum = result.rows.reduce((sum, row) => sum + row.adtTotal, 0);
  const withWorks = result.rows.filter((row) => row.target > 0).length;

  const stage3Seconds = result.rows.length * PAGES_PER_ACTOR * REQUEST_INTERVAL_SECONDS;
  const stage4Seconds = distribution.sum * REQUEST_INTERVAL_SECONDS;

  const lines: string[] = [];
  lines.push("# ポケドラ 声優タグ辞書と AniList の交差");
  lines.push("");
  lines.push("Date: 2026-09-18");
  lines.push("Status: 段階 1 (声優タグ辞書) 完了 / 段階 2 (交差の測定) 完了");
  lines.push("Scope: ポケドラの取得手順の段階 1 (声優タグ辞書)・2 (交差の測定)");
  lines.push("");
  lines.push("本書の数字はすべて実データから機械的に出した。推測には「(推測)」と明記する。");
  lines.push("再生成: `node crawler/discovery/pokedora-intersect.ts` (ネットワークに出ない)");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 1. 声優タグ辞書の収集実績");
  lines.push("");
  lines.push("| 項目 | 値 |");
  lines.push("|---|---:|");
  lines.push(`| sitemap のタグ URL 総数 | ${cache.sitemapUrlCount} |`);
  lines.push(`| うち声優 (tag_type=1) | ${cache.tagIdCount} |`);
  lines.push(`| 引いたタグページ | ${summary.total} |`);
  lines.push(`| 名前が取れた | ${summary.ok} |`);
  lines.push(`| 引けたが名前が取れない | ${summary.noName} |`);
  lines.push(`| 取得に失敗 | ${summary.failed} |`);
  lines.push("");
  if (summary.failed > 0) {
    lines.push("失敗の内訳:");
    lines.push("");
    lines.push("| 種別 | 件数 |");
    lines.push("|---|---:|");
    for (const [key, count] of Object.entries(summary.failuresByStatus).sort(
      (a, b) => b[1] - a[1],
    )) {
      lines.push(
        `| ${key === "network" ? "ネットワーク・タイムアウト" : `HTTP ${key}`} | ${count} |`,
      );
    }
    lines.push("");
  }
  lines.push(`収集期間: ${cache.startedAt} 〜 ${cache.updatedAt}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`## 2. AniList ${input.staffCount} 人との交差`);
  lines.push("");
  lines.push("突き合わせは `src/domain/normalize.ts` の `normalizeName` による完全一致。");
  lines.push("かな⇄カナの変換はしないので、表記が違うだけの同一人物は交差に現れない。");
  lines.push("");
  lines.push(
    "AniList 側は発見スパイク (`docs/research/discovery-spike-2026-09-18.md`) と同じ手順で集めた集合。" +
      "nativeName が無く突き合わせ不能だった人はこの数に含まれていない。" +
      "スパイク実施時は 2,569 人だったが、本書が使ったキャッシュは 2026-09-18 23:54 に再生成されており " +
      `${input.staffCount} 人になっている。AniList 側の登録が日々変わるためで、対象シーズン (12) と作品数 (1,176) は同じ。`,
  );
  lines.push("");
  lines.push("| 項目 | 値 |");
  lines.push("|---|---:|");
  lines.push(`| AniList の日本語声優 (nativeName があり突き合わせ可能) | ${input.staffCount} |`);
  lines.push(
    `| ポケドラで名前が取れた声優 (正規化後の異なり) | ${result.rows.length + result.pokedoraOnly.length} |`,
  );
  lines.push(`| **交差人数** | **${result.rows.length}** |`);
  lines.push(`| うち一般 + BL に 1 件以上ある | ${withWorks} |`);
  lines.push(`| ポケドラにしか居ない | ${result.pokedoraOnly.length} |`);
  lines.push("");
  const intersectionRate = ((result.rows.length / Math.max(input.staffCount, 1)) * 100).toFixed(1);
  lines.push(
    `AniList 側から見ると ${input.staffCount} 人中 ${result.rows.length} 人 (${intersectionRate}%) がポケドラに居る。`,
  );
  lines.push("");
  lines.push("### 2-1. 字体の違い");
  lines.push("");
  lines.push(
    "**この交差は異体字を畳んだ後の数字である。** 両サイトで漢字の字体が割れる実例があり " +
      "(ポケドラ 天﨑滉平 / AniList 天崎滉平)、初回の計測 (2026-09-18) では畳めば交差に入る人が " +
      "8 人 (延べ 60 件) 漏れていた。その後 `normalizeName` に人名の異体字の変換表を入れたので " +
      "上の交差人数にはこの層が含まれている。",
  );
  lines.push("");
  lines.push(
    "畳む対象は常用漢字表の康熙字典体と、NFKC が畳まない互換漢字 (﨑 U+FA11) に限っている。" +
      "字体の違いは Unicode と告示から機械的に判定できるが、かな表記の揺れと別名義は別問題で、" +
      "ここには含まれていない。",
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 3. 交差した声優の作品数");
  lines.push("");
  lines.push(
    "オトナ向け 2 ストア (`adt` / `adt-bl`) は取得対象外 (`docs/decisions/0003-no-r18-keep-bl.md`)。参考として合計だけ載せる。",
  );
  lines.push("");
  lines.push("| 区分 | 合計件数 |");
  lines.push("|---|---:|");
  lines.push(`| 一般 (men) | ${menSum} |`);
  lines.push(`| BL (bl) | ${blSum} |`);
  lines.push(`| **取得対象 (一般 + BL)** | **${menSum + blSum}** |`);
  lines.push(`| (参考) オトナ向け + オトナBL | ${adtSum} |`);
  lines.push("");
  lines.push("1 人あたりの取得対象件数の分布 (交差した全員が母数。0 件の人を含む):");
  lines.push("");
  lines.push("| 統計量 | 件数 |");
  lines.push("|---|---:|");
  lines.push(`| 人数 | ${distribution.count} |`);
  lines.push(`| 平均 | ${distribution.mean.toFixed(1)} |`);
  lines.push(`| 中央値 | ${distribution.median} |`);
  lines.push(`| 上位 25% (p75) | ${distribution.p75} |`);
  lines.push(`| 上位 10% (p90) | ${distribution.p90} |`);
  lines.push(`| 最大 | ${distribution.max} |`);
  lines.push("");
  lines.push(
    "**この合計は延べ数である。** 1 作品に複数の声優が出ているので、同じ作品を複数の声優の欄で数えている。" +
      "実際に引く作品詳細のユニーク件数はこれより少ない (段階 3 を実行するまで確定しない)。",
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 4. DLsite / Audible との重なり");
  lines.push("");
  const inDlsite = result.rows.filter((row) => row.dlsite).length;
  const withWorksRowsAll = result.rows.filter((row) => row.target > 0);
  const withWorksInDlsite = withWorksRowsAll.filter((row) => row.dlsite).length;
  const audibleHit = result.rows.filter((row) => row.audible === "yes").length;
  const audibleProbed = result.rows.filter((row) => row.audible !== "unknown").length;
  lines.push(
    "ポケドラを足す価値は「既存の 2 ストアで取れない声優をどれだけ拾えるか」で決まる。" +
      "ここでの DLsite は全カタログではなく発見スパイクの直近サンプルなので、下の数字は**重なりの上限ではなく観測された重なり**である。",
  );
  lines.push("");
  lines.push("| 項目 | 人数 |");
  lines.push("|---|---:|");
  lines.push(`| 交差した声優 | ${result.rows.length} |`);
  lines.push(`| うちポケドラに作品が 1 件以上 | ${withWorksRowsAll.length} |`);
  lines.push(`| そのうち DLsite の直近サンプルにも名前がある | ${withWorksInDlsite} |`);
  lines.push(
    `| **そのうち DLsite の直近サンプルには居ない** | **${withWorksRowsAll.length - withWorksInDlsite}** |`,
  );
  lines.push(`| (参考) 交差全体のうち DLsite サンプルに居る | ${inDlsite} |`);
  lines.push(
    `| (参考) Audible を実際に引いた人 / うち作品あり | ${audibleProbed} / ${audibleHit} |`,
  );
  lines.push("");
  lines.push(
    `DLsite 側の照合に使ったのは直近 ${input.dlsiteWorkCount} 作品に出ていた声優 ${input.dlsiteNameCount} 名義だけで、` +
      "その大半が同人音声の名義である。ポケドラで作品数の多い層 (BL ドラマ CD の常連) とはほとんど重ならない。",
  );
  lines.push("");
  lines.push(
    `**${withWorksRowsAll.length - withWorksInDlsite} 人を「DLsite では取れない声優」として読んではいけない。**` +
      "母数が直近サンプルなので、DLsite の全カタログを引けば重なりはこれより増える。" +
      "この節が言えるのは「ポケドラで作品数が多い層は、DLsite の直近全年齢音声にはほぼ出ていない」までである。" +
      "確定させるには DLsite 側を声優名で引き直す必要がある。",
  );
  lines.push("");
  lines.push(
    `取得対象 ${menSum + blSum} 件のうち BL が ${blSum} 件 (${((blSum / Math.max(menSum + blSum, 1)) * 100).toFixed(0)}%) を占める。` +
      "BL ドラマ CD は男性声優が本名義で出演するのが通例で (ストア横断調査 §1)、この層は DLsite 全年齢の直近サンプルには現れていない。",
  );
  lines.push("");
  lines.push(
    "Audible はスパイクが引いた人数が少なく、しかも空振りした検索のスナップショットが残っていないため、" +
      "ここから全体の重なりは言えない。ポケドラを採用するかどうかの判断材料としては**未計測**である。" +
      "スパイクは別途 20 人を引いて 7 人に作品ありと記録している (発見スパイク §7)。",
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`## 5. 交差の上位 ${TOP_ROWS} 人`);
  lines.push("");
  lines.push(
    `DLsite 列は発見スパイクで取った直近 ${input.dlsiteWorkCount} 作品の \`voice_by\` に名前があるかで、` +
      "DLsite の全カタログを引いた結果ではない。× は「直近の作品に出ていない」であって「DLsite に居ない」ではない。",
  );
  lines.push(
    `Audible 列は発見スパイクが残した ${input.audibleProbedCount} 人ぶんの検索結果スナップショットからの復元。` +
      "空振りした検索はスナップショットが残らないので、この列に × は出ず「○ か 未調査」しか取らない。",
  );
  lines.push("");
  lines.push("| # | 名前 | tag_id | 一般 | BL | 合計 | DLsite | Audible | AniList 出演役数 |");
  lines.push("|---:|---|---:|---:|---:|---:|---|---|---:|");
  result.rows.slice(0, TOP_ROWS).forEach((row, index) => {
    const tagIds = row.tagIds.join(", ");
    lines.push(
      `| ${index + 1} | ${row.name}${row.anilistAmbiguous ? " ※" : ""} | ${tagIds} | ${row.men} | ${row.bl} | ${row.target} | ${row.dlsite ? "○" : "×"} | ${formatAudible(row.audible)} | ${row.anilistRoleCount} |`,
    );
  });
  lines.push("");
  lines.push("※ は AniList 側に同じ nativeName の別 staff が居る人。");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`## 6. ポケドラにしか居ない声優 (上位 ${POKEDORA_ONLY_ROWS})`);
  lines.push("");
  const onlyDistribution = describeDistribution(result.pokedoraOnly.map((actor) => actor.target));
  lines.push(
    `AniList の ${input.staffCount} 人に名前が無いポケドラ声優は **${result.pokedoraOnly.length} 人**、` +
      `取得対象の作品は延べ **${onlyDistribution.sum} 件** (中央値 ${onlyDistribution.median} / 最大 ${onlyDistribution.max})。`,
  );
  lines.push("");
  lines.push(
    "この層には、アニメ出演の無い音声作品専業の声優のほか、AniList に別表記で載っている人や、" +
      "タグが人名でないもの (ユニット名など) が混ざっている可能性がある (推測)。" +
      "別表記のうち漢字の字体違いは §2-1 で数えた 8 人で、残りの見分けは付いていない。",
  );
  lines.push("");
  lines.push("| # | 名前 | tag_id | 一般 | BL | 合計 |");
  lines.push("|---:|---|---:|---:|---:|---:|");
  result.pokedoraOnly.slice(0, POKEDORA_ONLY_ROWS).forEach((actor, index) => {
    lines.push(
      `| ${index + 1} | ${actor.name} | ${actor.tagId} | ${actor.men} | ${actor.bl} | ${actor.target} |`,
    );
  });
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 7. 段階 3・4 の所要時間");
  lines.push("");
  lines.push("いずれも 5 秒間隔 (`crawler/lib/fetch.ts` のポケドラ設定) で計算した。");
  lines.push("");
  lines.push("| 段階 | 内容 | リクエスト数 | 所要 |");
  lines.push("|---|---|---:|---:|");
  lines.push(
    `| 3 | 交差した ${result.rows.length} 人のタグページ (一般 + BL の 2 回) | ${result.rows.length * PAGES_PER_ACTOR} | ${formatHours(stage3Seconds)} |`,
  );
  lines.push(
    `| 4 | 出てきた作品の詳細 (延べ ${distribution.sum} 件の上限) | ${distribution.sum} | ${formatHours(stage4Seconds)} |`,
  );
  lines.push(
    `| | **合計 (上限)** | **${result.rows.length * PAGES_PER_ACTOR + distribution.sum}** | **${formatHours(stage3Seconds + stage4Seconds)}** |`,
  );
  lines.push("");
  lines.push(
    "段階 4 は延べ件数で見積もった上限で、重複を除けば短くなる。" +
      "作品数の多い声優を上位から絞れば線形に短縮できる。",
  );
  lines.push("");
  lines.push("### 7-1. 辞書を使って絞った場合");
  lines.push("");
  lines.push(
    "辞書に 4 ストアの件数が入っているので、**引く前に無駄なリクエストを落とせる**。" +
      "作品が 0 件の声優はタグページを引く必要がなく、片方のストアが 0 件ならそちらのページも要らない。",
  );
  lines.push("");
  // 件数が 0 のストアのページは引く意味がないので、実際に必要なページ数を数える
  const neededPages = result.rows.reduce(
    (sum, row) => sum + (row.men > 0 ? 1 : 0) + (row.bl > 0 ? 1 : 0),
    0,
  );
  const stage3Narrow = neededPages * REQUEST_INTERVAL_SECONDS;
  lines.push("| 段階 | 内容 | リクエスト数 | 所要 |");
  lines.push("|---|---|---:|---:|");
  lines.push(
    `| 3 | 件数が 1 以上のストアのページだけを引く (${withWorks} 人ぶん) | ${neededPages} | ${formatHours(stage3Narrow)} |`,
  );
  lines.push(
    `| 4 | 作品詳細 (延べ ${distribution.sum} 件の上限) | ${distribution.sum} | ${formatHours(stage4Seconds)} |`,
  );
  lines.push(
    `| | **合計** | **${neededPages + distribution.sum}** | **${formatHours(stage3Narrow + stage4Seconds)}** |`,
  );
  lines.push("");
  lines.push(
    `段階 3 の所要は ${formatHours(stage3Seconds)} から ${formatHours(stage3Narrow)} に縮む。` +
      "段階 4 は延べ件数のままなので縮まない。重複を除いたユニーク作品数は段階 3 を実行するまで確定しない。",
  );
  lines.push("");
  const top200 = [...result.rows].slice(0, 200).reduce((sum, row) => sum + row.target, 0);
  lines.push(
    `作品数の上位 200 人に絞れば段階 4 は延べ ${top200} 件 (${formatHours(top200 * REQUEST_INTERVAL_SECONDS)}) で、` +
      `取得対象 ${distribution.sum} 件の ${((top200 / Math.max(distribution.sum, 1)) * 100).toFixed(0)}% を押さえられる。`,
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 8. 同名で曖昧なケース");
  lines.push("");
  if (result.duplicateNames.length === 0) {
    lines.push("ポケドラ側で同じ名前に複数の tag_id が付いている組は無かった。");
  } else {
    lines.push(
      `ポケドラ側で同じ名前に複数の tag_id が付いている組が **${result.duplicateNames.length} 件**あった。` +
        "どちらの tag_id を引くかを辞書だけでは決められないので、段階 3 では両方を引いて件数で判断する。",
    );
    lines.push("");
    lines.push("| 名前 | tag_id | 一般 | BL |");
    lines.push("|---|---|---:|---:|");
    for (const duplicate of result.duplicateNames.slice(0, 30)) {
      for (const actor of duplicate.actors) {
        lines.push(`| ${duplicate.name} | ${actor.tagId} | ${actor.men} | ${actor.bl} |`);
      }
    }
  }
  lines.push("");
  const ambiguousRows = result.rows.filter((row) => row.anilistAmbiguous);
  lines.push(
    ambiguousRows.length === 0
      ? "AniList 側に同名の別 staff が居る人は交差に含まれていない。"
      : `AniList 側に同名の別 staff が居る人は ${ambiguousRows.length} 人 (上の表で ※)。名前だけでは誰の作品か断定できない。`,
  );
  lines.push("");

  return `${lines.join("\n")}\n`;
}

// --- 本体 ------------------------------------------------------------------

export async function main(): Promise<number> {
  const cache = await readJson<PokedoraTagsCache>(TAGS_JSON);
  const anilist = await readJson<{ staff: StaffRecord[] }>(ANILIST_STAFF_JSON);
  const works = await readJson<DlsiteWorkRecord[]>(DLSITE_WORKS_JSON);
  const audibleByName = await readAudiblePresence();

  const actors = toActors(cache.records);
  const dlsiteNames = dlsiteVoiceNames(works);
  const result = intersect({ actors, staff: anilist.staff, dlsiteNames, audibleByName });

  const report = buildReport({
    cache,
    result,
    staffCount: anilist.staff.length,
    dlsiteWorkCount: works.length,
    dlsiteNameCount: dlsiteNames.size,
    audibleProbedCount: audibleByName.size,
  });
  await writeFile(REPORT_PATH, report, "utf8");

  console.log(`ポケドラ声優タグ: ${cache.records.length} 件を処理`);
  console.log(`交差: ${result.rows.length} 人 / ポケドラのみ: ${result.pokedoraOnly.length} 人`);
  console.log(`同名で複数 tag_id: ${result.duplicateNames.length} 組`);
  console.log(`報告: ${REPORT_PATH}`);
  return 0;
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
