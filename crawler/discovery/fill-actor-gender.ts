import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { VoiceActorGender } from "../../src/domain/index.ts";
import { describeGenderCounts } from "../lib/ingest.ts";
import { writeJsonAtomic } from "../lib/json-file.ts";
import { CRAWLER_DIR } from "../lib/paths.ts";
import type { ActorEntity } from "./actor-entity.ts";
import {
  type ActorGenderRecord,
  GENDER_JSON,
  genderByStaffId,
  readGenderCache,
} from "./actor-gender.ts";

/**
 * staff id から引いた性別を、今ある対象声優リストの該当行に書き入れる。
 *
 *   node crawler/discovery/fill-actor-gender.ts
 *
 * リストは staff 集計から作り直さずに、読んだものをそのまま書き戻す。作り直すと、
 * シーズンの窓から外れた声優がリストごと消える。性別が取れるのはまさにその人たちなので、
 * 作り直しは性別を埋める目的と逆に働く (取得は `anilist-gender.ts`)。
 * ネットワークには出ない。
 */

const DEFAULT_ACTORS_JSON = path.join(CRAWLER_DIR, "actors.generated.json");

const USAGE = `使い方:
  node crawler/discovery/fill-actor-gender.ts [オプション]

オプション:
  --actors <path>  対象声優リスト (既定 crawler/actors.generated.json)
  --gender <path>  staff id から引いた性別 (既定 crawler/.cache/discovery/anilist-gender.json)
  --dry-run        書き戻さず、何人ぶん埋まるかだけ出す
`;

const OPTION_SPEC = {
  actors: { type: "string" },
  gender: { type: "string" },
  "dry-run": { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

export type FillResult = {
  actors: ActorEntity[];
  /** 書き入れた人 */
  filled: Array<{ canonicalName: string; gender: VoiceActorGender }>;
  /** 書き入れた後も「不明」のままの人数 */
  remainingUnknown: number;
};

/**
 * 「不明」の行にだけ性別を書き入れる。
 *
 * 行の並びと個数は入力のまま。既に性別が付いている行には触らない (AniList に 2 回聞いた答えが
 * 食い違ったときに、後から引いたほうを正とする根拠が無い)。書き換えるのは `gender` の値だけで、
 * 他の欄は元の行をそのまま広げて持ち越す
 */
export function fillGender(
  actors: readonly ActorEntity[],
  gender: Record<number, VoiceActorGender>,
): FillResult {
  const filled: Array<{ canonicalName: string; gender: VoiceActorGender }> = [];
  let remainingUnknown = 0;

  const next = actors.map((actor) => {
    if (actor.gender !== "unknown") return actor;
    const fetched = gender[actor.anilistStaffId];
    if (fetched === undefined || fetched === "unknown") {
      remainingUnknown += 1;
      return actor;
    }
    filled.push({ canonicalName: actor.canonicalName, gender: fetched });
    return { ...actor, gender: fetched };
  });

  return { actors: next, filled, remainingUnknown };
}

/**
 * 取得結果の名前と、リストの名前が食い違う声優。
 *
 * 突き合わせの鍵は staff id なので名前が違っても書き入れられるが、AniList 側で id と名前の
 * 対応が変わっていた場合、別人の性別を書き入れることになる。止めはしないが必ず目に入るようにする
 */
export function nameMismatches(
  actors: readonly ActorEntity[],
  records: readonly ActorGenderRecord[],
): Array<{ anilistStaffId: number; listName: string; anilistName: string }> {
  const byStaffId = new Map(actors.map((actor) => [actor.anilistStaffId, actor]));
  const mismatches: Array<{ anilistStaffId: number; listName: string; anilistName: string }> = [];
  for (const record of records) {
    if (record.nativeName === undefined) continue;
    const actor = byStaffId.get(record.anilistStaffId);
    if (actor === undefined || actor.canonicalName === record.nativeName) continue;
    mismatches.push({
      anilistStaffId: record.anilistStaffId,
      listName: actor.canonicalName,
      anilistName: record.nativeName,
    });
  }
  return mismatches;
}

/** 対象声優リストを読む。書き戻すときに形を壊さないよう、配列であることだけ確かめる */
export async function loadActors(file: string): Promise<ActorEntity[]> {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${file} が配列ではない`);
  return parsed as ActorEntity[];
}

export async function main(argv: readonly string[]): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  try {
    values = parseArgs({ args: [...argv], options: OPTION_SPEC, allowPositionals: false }).values;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 1;
  }
  if (values.help === true) {
    process.stdout.write(USAGE);
    return 0;
  }

  const actorsFile = asString(values.actors) ?? DEFAULT_ACTORS_JSON;
  const genderFile = asString(values.gender) ?? GENDER_JSON;

  const cache = await readGenderCache(genderFile);
  if (cache === undefined) {
    process.stderr.write(
      `[エラー] staff id から引いた性別が無い: ${genderFile}\n` +
        "  node crawler/discovery/anilist-gender.ts で引いてから実行する\n",
    );
    return 1;
  }

  const actors = await loadActors(actorsFile);
  const result = fillGender(actors, genderByStaffId(cache.records));

  process.stdout.write(`対象声優: ${actors.length} 人 (${actorsFile})\n`);
  process.stdout.write(`  取得結果: ${cache.records.length} 人ぶん (${genderFile})\n`);
  process.stdout.write(`  書き入れる: ${result.filled.length} 人\n`);
  process.stdout.write(`  書き入れても「不明」のまま: ${result.remainingUnknown} 人\n`);
  process.stdout.write(`  書き入れた後の内訳: ${describeGenderCounts(result.actors)}\n`);

  for (const mismatch of nameMismatches(actors, cache.records)) {
    process.stderr.write(
      `[警告] staff ${mismatch.anilistStaffId} の名前が食い違う: ` +
        `リスト「${mismatch.listName}」/ AniList「${mismatch.anilistName}」\n`,
    );
  }

  if (values["dry-run"] === true) {
    process.stdout.write("\n--dry-run なので書き戻さない\n");
    return 0;
  }
  if (result.filled.length === 0) {
    process.stdout.write("\n書き入れるものが無いので触らない\n");
    return 0;
  }

  // 生成 (`build-actors.ts`) と同じ書き方 (2 空白インデント + 末尾の改行) にする。
  // 違えると、書き入れていない行まで差分に出る。`writeJsonAtomic` はこの書き方のまま、
  // 途中で中断されても追跡されているリストが切り詰められないようにする
  await writeJsonAtomic(actorsFile, result.actors);
  process.stdout.write(`\n書き戻した: ${actorsFile}\n`);
  return 0;
}

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// 直接実行されたときだけ動かす。テストから import しても走らないようにするため
const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
