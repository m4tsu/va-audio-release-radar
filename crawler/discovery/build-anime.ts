import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { CACHE_DIR, CRAWLER_DIR } from "../lib/paths.ts";
import {
  type AnimeCreditInput,
  type AnimeEntity,
  type AnimeExclusionReason,
  type AnimeMediaInput,
  buildAnimeEntities,
  describeAnimeExclusionReason,
  type TargetActorInput,
} from "./anime-entity.ts";

/**
 * アニメ導線のデータ生成。
 *
 *   node crawler/discovery/build-anime.ts
 *
 * 発見スパイクが集めた AniList の中間結果と `crawler/actors.generated.json` を合わせて、
 * `crawler/anime.generated.json` を作る。ネットワークには出ない。
 *
 * 出力に入れるのは「対象声優が 1 人以上出ている作品」だけ。全キャストを保存すると
 * AniList の Hoarding 禁止に触れ、「アニメのキャスト DB ではない」という製品の線
 * (`docs/product.md` の「作らないもの」) も越える
 */

const DISCOVERY_DIR = path.join(CACHE_DIR, "discovery");
const DEFAULT_STAFF_JSON = path.join(DISCOVERY_DIR, "anilist-staff.json");
const DEFAULT_CREDITS_JSON = path.join(DISCOVERY_DIR, "anilist-credits.json");
const DEFAULT_ACTORS_JSON = path.join(CRAWLER_DIR, "actors.generated.json");
const DEFAULT_OUT_JSON = path.join(CRAWLER_DIR, "anime.generated.json");

const USAGE = `使い方:
  node crawler/discovery/build-anime.ts [オプション]

オプション:
  --staff <path>     AniList の中間結果 (既定 crawler/.cache/discovery/anilist-staff.json)
  --credits <path>   AniList の出演の生データ (既定 crawler/.cache/discovery/anilist-credits.json)
  --actors <path>    対象声優 (既定 crawler/actors.generated.json)
  --out <path>       出力先 (既定 crawler/anime.generated.json)
`;

const OPTION_SPEC = {
  staff: { type: "string" },
  credits: { type: "string" },
  actors: { type: "string" },
  out: { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

// --- 入力の読み込み --------------------------------------------------------

/** `anilist-staff.json` の `media[]`。作品のタイトルとシーズンはここにしか無い */
export async function loadMedia(file: string): Promise<AnimeMediaInput[]> {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  const media = (parsed as { media?: unknown })?.media;
  if (!Array.isArray(media)) {
    throw new Error(
      `${file} に media 配列が無い。取得項目を増やす前の中間結果なので、` +
        "node crawler/discovery/run.ts --anilist-only で取り直す",
    );
  }
  const items = media as AnimeMediaInput[];
  // titleRomaji はキャラクター名などと一緒に足した項目。1 件も無ければ、取得項目を増やす前の
  // 応答から作られた中間結果なので、そのまま進めると全作品が「slug を作れない」で消える
  if (items.length > 0 && items.every((item) => item.titleRomaji === undefined)) {
    throw new Error(
      `${file} の media に titleRomaji が 1 件も無い。取得項目を増やす前の応答なので、` +
        "node crawler/discovery/run.ts --anilist-only で取り直す",
    );
  }
  // 人気度も後から足した項目。phase の中間結果 (anilist-staff.json) はクエリの指紋を見ずに
  // 再利用されるので、--refresh を付け忘れると古い応答のまま全作品が人気度なしで通る
  if (items.length > 0 && items.every((item) => item.popularity === undefined)) {
    throw new Error(
      `${file} の media に popularity が 1 件も無い。取得項目を増やす前の応答なので、` +
        "node crawler/discovery/run.ts --anilist-only --refresh で取り直す",
    );
  }
  return items;
}

/** `anilist-credits.json`。1 作品 × 1 キャラクター × 1 声優の出演が並んでいる */
export async function loadCredits(file: string): Promise<AnimeCreditInput[]> {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${file} が配列ではない`);
  const credits = parsed as AnimeCreditInput[];
  // キャラクター名は取得項目を増やしてから入った。古い生データを黙って使うと
  // キャラクター名が全件空のまま画面まで通ってしまう。
  // characterId では検出できない (旧クエリにも node { id } があったため)
  if (credits.length > 0 && credits.every((credit) => credit.characterNameNative === undefined)) {
    throw new Error(
      `${file} に characterId が無い。取得項目を増やす前の生データなので、` +
        "node crawler/discovery/run.ts --anilist-only で取り直す",
    );
  }
  return credits;
}

/** `actors.generated.json`。AniList の staff と突き合わせるので anilistStaffId がある人だけ使う */
export async function loadTargetActors(file: string): Promise<TargetActorInput[]> {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${file} が配列ではない`);
  const actors: TargetActorInput[] = [];
  for (const raw of parsed) {
    const record = raw as { id?: unknown; anilistStaffId?: unknown };
    if (typeof record.id !== "string") continue;
    if (typeof record.anilistStaffId !== "number") continue;
    actors.push({ id: record.id, anilistStaffId: record.anilistStaffId });
  }
  return actors;
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

  const staffFile = asString(values.staff) ?? DEFAULT_STAFF_JSON;
  const creditsFile = asString(values.credits) ?? DEFAULT_CREDITS_JSON;
  const actorsFile = asString(values.actors) ?? DEFAULT_ACTORS_JSON;
  const outFile = asString(values.out) ?? DEFAULT_OUT_JSON;

  const [media, credits, targetActors] = await Promise.all([
    loadMedia(staffFile),
    loadCredits(creditsFile),
    loadTargetActors(actorsFile),
  ]);

  const result = buildAnimeEntities(media, credits, targetActors);

  process.stdout.write(`作品: ${media.length} 件 (${staffFile})\n`);
  process.stdout.write(`出演: ${credits.length} 件 (${creditsFile})\n`);
  process.stdout.write(`対象声優: ${targetActors.length} 人 (${actorsFile})\n`);
  process.stdout.write(`  除外: ${result.excluded.length} 件\n`);
  for (const [reason, count] of countByReason(result.excluded)) {
    process.stdout.write(`    ${describeAnimeExclusionReason(reason)}: ${count} 件\n`);
  }
  process.stdout.write(`  生成: ${result.anime.length} 件\n`);

  const appearanceCount = result.anime.reduce((sum, item) => sum + item.appearances.length, 0);
  const actorsWithAnime = new Set(
    result.anime.flatMap((item) => item.appearances.map((a) => a.voiceActorId)),
  ).size;
  process.stdout.write(`  出演: ${appearanceCount} 件 / 声優 ${actorsWithAnime} 人\n`);
  process.stdout.write(
    `  英語タイトルあり: ${result.anime.filter((item) => item.titleEnglish !== undefined).length} 件\n`,
  );
  for (const [label, count] of countByField(result.anime)) {
    process.stdout.write(`  ${label}: ${count} 件 (未取得 ${result.anime.length - count} 件)\n`);
  }

  if (result.collisions.length > 0) {
    process.stderr.write(`\n[エラー] slug が ${result.collisions.length} 件衝突した\n`);
    for (const collision of result.collisions) {
      const members = collision.members
        .map((member) => `${member.titleRomaji} (${member.id})`)
        .join(" / ");
      process.stderr.write(`  ${collision.slug}: ${members}\n`);
    }
    process.stderr.write(
      "自動で連番は振らない (実行のたびにどちらが正か入れ替わり、別作品の出演者が混ざるため)。" +
        "どちらを正とするかは人が決める\n",
    );
    return 1;
  }

  await writeFile(outFile, `${JSON.stringify(result.anime, null, 2)}\n`, "utf8");
  process.stdout.write(`\n書き出した: ${outFile}\n`);
  return 0;
}

/**
 * 項目ごとに値が入った作品数。
 *
 * AniList が返さないことがある項目 (放送終了日、別名タイトル、代表色) を後から足したとき、
 * 取り直しを忘れて全件空のまま取り込んでいないかを、この数で見分ける
 */
export function countByField(anime: readonly AnimeEntity[]): Array<[string, number]> {
  return [
    ["人気度あり", anime.filter((item) => item.popularity !== undefined).length],
    ["形式あり", anime.filter((item) => item.format !== undefined).length],
    ["放送開始日あり", anime.filter((item) => item.startDate !== undefined).length],
    ["放送終了日あり", anime.filter((item) => item.endDate !== undefined).length],
    ["別名タイトルあり", anime.filter((item) => item.synonyms !== undefined).length],
    ["表紙の代表色あり", anime.filter((item) => item.coverImageColor !== undefined).length],
  ];
}

/** 除外理由ごとの件数。多い順に並べる */
function countByReason(
  excluded: readonly { reason: AnimeExclusionReason }[],
): Array<[AnimeExclusionReason, number]> {
  const counts = new Map<AnimeExclusionReason, number>();
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
