import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { CACHE_DIR, CRAWLER_DIR } from "../lib/paths.ts";
import {
  type ActorOverrides,
  buildActorEntities,
  describeExclusionReason,
  type ExclusionReason,
  type StaffInput,
} from "./actor-entity.ts";

/**
 * 対象声優リストの生成 (T13 / 設計書 §9)。
 *
 *   node crawler/discovery/build-actors.ts
 *
 * 発見スパイクが集めた AniList の staff 集計 (`.cache/discovery/anilist-staff.json`) と、
 * AniList から取れない情報だけを手で持つ `crawler/actors-overrides.json` を合わせて、
 * `crawler/actors.generated.json` を作る。ネットワークには出ない。
 *
 * 作品が 1 件も無い声優も含めて全員を出力する。クロール履歴を残しておけば、
 * 翌日以降にその声優の作品が出たときに拾える (ページを作るかどうかは表示側で決める)
 */

const DISCOVERY_DIR = path.join(CACHE_DIR, "discovery");
const DEFAULT_STAFF_JSON = path.join(DISCOVERY_DIR, "anilist-staff.json");
const DEFAULT_OVERRIDES_JSON = path.join(CRAWLER_DIR, "actors-overrides.json");
const DEFAULT_OUT_JSON = path.join(CRAWLER_DIR, "actors.generated.json");

const USAGE = `使い方:
  node crawler/discovery/build-actors.ts [オプション]

オプション:
  --staff <path>          AniList の staff 集計 (既定 crawler/.cache/discovery/anilist-staff.json)
  --overrides <path>      手書きオーバーライド (既定 crawler/actors-overrides.json)
  --out <path>            出力先 (既定 crawler/actors.generated.json)
  --min-role-count <N>    roleCount がこの値未満の声優を落とす (既定 0 = 全員)
`;

const OPTION_SPEC = {
  staff: { type: "string" },
  overrides: { type: "string" },
  out: { type: "string" },
  "min-role-count": { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

// --- 入力の読み込み --------------------------------------------------------

/** `anilist-staff.json` の `staff[]`。中身の形は `StaffInput` に合わせて信用する */
export async function loadStaff(file: string): Promise<StaffInput[]> {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  const staff = (parsed as { staff?: unknown })?.staff;
  if (!Array.isArray(staff)) throw new Error(`${file} に staff 配列が無い`);
  return staff as StaffInput[];
}

/** オーバーライドは無くてもよい (AniList だけで生成できる) ので、無ければ空として扱う */
export async function loadOverrides(file: string): Promise<ActorOverrides> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    process.stdout.write(`オーバーライドが無いので AniList だけで生成する: ${file}\n`);
    return {};
  }
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${file} がオブジェクトではない`);
  }
  return parsed as ActorOverrides;
}

// --- 本体 ------------------------------------------------------------------

export async function main(argv: readonly string[]): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  try {
    values = parseArgs({ args: [...argv], options: OPTION_SPEC }).values;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 1;
  }

  if (values.help === true) {
    process.stdout.write(USAGE);
    return 0;
  }

  const minRoleCountOption = asString(values["min-role-count"]);
  const minRoleCount = minRoleCountOption === undefined ? 0 : Number(minRoleCountOption);
  if (!Number.isInteger(minRoleCount) || minRoleCount < 0) {
    process.stderr.write(`--min-role-count は 0 以上の整数を指定する: ${minRoleCountOption}\n`);
    return 1;
  }

  const staffFile = asString(values.staff) ?? DEFAULT_STAFF_JSON;
  const overridesFile = asString(values.overrides) ?? DEFAULT_OVERRIDES_JSON;
  const outFile = asString(values.out) ?? DEFAULT_OUT_JSON;

  const [staff, overrides] = await Promise.all([
    loadStaff(staffFile),
    loadOverrides(overridesFile),
  ]);

  // roleCount による絞り込みは除外理由とは別に数える。「AniList に居るが薄い」のと
  // 「そもそも slug を作れない」のは意味が違うため
  const target = staff.filter((record) => (record.roleCount ?? 0) >= minRoleCount);
  const belowMinRoleCount = staff.length - target.length;

  const result = buildActorEntities(target, overrides);

  process.stdout.write(`staff: ${staff.length} 人 (${staffFile})\n`);
  if (minRoleCount > 0) {
    process.stdout.write(`  roleCount < ${minRoleCount} で除外: ${belowMinRoleCount} 人\n`);
  }
  process.stdout.write(`  除外: ${result.excluded.length} 人\n`);
  for (const [reason, count] of countByReason(result.excluded)) {
    process.stdout.write(`    ${describeExclusionReason(reason)}: ${count} 人\n`);
  }
  // no-slug は fullName が無い/記号だけの人なので、書き損じでないか目視で確認できるよう名前も出す (T14)
  const noSlugNames = result.excluded
    .filter((item) => item.reason === "no-slug")
    .map((item) => item.nativeName);
  if (noSlugNames.length > 0) {
    process.stdout.write(`      内訳: ${noSlugNames.join("、")}\n`);
  }
  process.stdout.write(`  生成: ${result.actors.length} 人\n`);
  process.stdout.write(
    `  かな付き: ${result.actors.filter((actor) => actor.nameKana !== undefined).length} 人 / ` +
      `検証済み別名: ${result.actors.filter((actor) => actor.aliases.some((alias) => alias.verified)).length} 人\n`,
  );

  for (const key of result.unusedOverrideKeys) {
    // AniList 側の表記が変わるとオーバーライドが黙って効かなくなるので、必ず気づけるようにする
    process.stderr.write(`[警告] overrides の "${key}" に対応する声優が AniList 側に居ない\n`);
  }

  if (result.collisions.length > 0) {
    process.stderr.write(`\n[エラー] slug が ${result.collisions.length} 件衝突した\n`);
    for (const collision of result.collisions) {
      const members = collision.members
        .map((member) => `${member.canonicalName} (staff ${member.anilistStaffId})`)
        .join(" / ");
      process.stderr.write(`  ${collision.slug}: ${members}\n`);
    }
    process.stderr.write(
      "自動で連番は振らない (同名別人を取り違えるため)。" +
        `${overridesFile} にどちらか一方の slug を書いて解決する\n`,
    );
    return 1;
  }

  await writeFile(outFile, `${JSON.stringify(result.actors, null, 2)}\n`, "utf8");
  process.stdout.write(`\n書き出した: ${outFile}\n`);
  return 0;
}

/** 除外理由ごとの件数。多い順に並べる */
function countByReason(
  excluded: readonly { reason: ExclusionReason }[],
): Array<[ExclusionReason, number]> {
  const counts = new Map<ExclusionReason, number>();
  for (const item of excluded) counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// 直接実行されたときだけ動かす (テストから import しても main が走らないようにするため)
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
