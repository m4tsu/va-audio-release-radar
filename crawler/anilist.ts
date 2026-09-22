import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { crawlAniList, recentSeasons, seasonLabel } from "./discovery/anilist.ts";
import { buildAniListPayloadsBySeason } from "./discovery/anilist-payload.ts";
import { AdminApiClient, AdminApiError, IngestProtocolMismatchError } from "./lib/ingest.ts";

/**
 * 週次の AniList 取り込み。
 *
 *   INGEST_TOKEN=dev node crawler/anilist.ts --base-url http://localhost:5199
 *
 * 対象シーズンを実行日から決め、各作品の出演者をページを送って全員取り、
 * `POST /api/admin/anilist` に送る。**途中のファイルを持たない。**
 * 台帳は DB で、行は消さない。窓から外れた声優も今回の応答に出なかった作品も残る。
 *
 * 初めて見た声優の slug は応答に入る。`--new-actors-out` を渡すとその一覧をファイルに書くので、
 * 続けて `node crawler/run.ts --only "$(cat <file>)"` に渡せば、その人だけを
 * 3 ストアで 1 回ずつ引ける (`docs/decisions/0007-daily-crawl-from-store-feeds.md` の「シーズンごと」)。
 *
 * 研究スパイク (`crawler/discovery/run.ts`) とは別物。あちらは実行日を固定して
 * 測定を再現するためのもので、この経路からは呼ばない
 */

/** 対象シーズン数。12 シーズン = 3 年 (docs/decisions/0001-target-actors-from-anilist.md) */
const DEFAULT_SEASONS = 12;
/** 1 シーズンあたりに取る作品数。人気順の上位から数える */
const DEFAULT_MEDIA_PER_SEASON = 100;

const USAGE = `使い方:
  INGEST_TOKEN=... node crawler/anilist.ts --base-url https://example.workers.dev [オプション]

オプション:
  --base-url <URL>          取り込み先。環境変数 INGEST_URL でも指定できる
  --base-date <YYYY-MM-DD>  対象シーズンを決める基準日 (既定 今日)
  --seasons <N>             対象シーズン数 (既定 ${DEFAULT_SEASONS})
  --media <N>               1 シーズンあたりの作品数 (既定 ${DEFAULT_MEDIA_PER_SEASON})
  --new-actors-out <path>   初めて見た声優の slug をカンマ区切りで書き出す
  --dry-run                 取得はするが DB へは送らない
  --no-snapshot             取得した生データを .cache/snapshots に保存しない
`;

const OPTION_SPEC = {
  "base-url": { type: "string" },
  "base-date": { type: "string" },
  seasons: { type: "string" },
  media: { type: "string" },
  "new-actors-out": { type: "string" },
  "dry-run": { type: "boolean" },
  "no-snapshot": { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

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

  const dryRun = values["dry-run"] === true;
  const baseUrl = asString(values["base-url"]) ?? process.env.INGEST_URL;
  const token = process.env.INGEST_TOKEN;
  if (!dryRun && (baseUrl === undefined || baseUrl === "")) {
    process.stderr.write(`--base-url か環境変数 INGEST_URL が要る\n\n${USAGE}`);
    return 1;
  }
  if (!dryRun && (token === undefined || token === "")) {
    process.stderr.write("環境変数 INGEST_TOKEN が要る\n");
    return 1;
  }

  const seasonCount = positiveInteger(values.seasons, DEFAULT_SEASONS);
  if (seasonCount === undefined) {
    process.stderr.write(`--seasons は 1 以上の整数を指定する: ${String(values.seasons)}\n`);
    return 1;
  }
  const mediaPerSeason = positiveInteger(values.media, DEFAULT_MEDIA_PER_SEASON);
  if (mediaPerSeason === undefined) {
    process.stderr.write(`--media は 1 以上の整数を指定する: ${String(values.media)}\n`);
    return 1;
  }

  const startedAt = new Date().toISOString();
  const baseDate = asString(values["base-date"]) ?? startedAt.slice(0, 10);
  let seasons: ReturnType<typeof recentSeasons>;
  try {
    seasons = recentSeasons(baseDate, seasonCount);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  const first = seasons[0];
  const last = seasons.at(-1);
  process.stdout.write(
    `基準日 ${baseDate} から ${seasons.length} シーズン: ` +
      `${first === undefined ? "-" : seasonLabel(first)} 〜 ` +
      `${last === undefined ? "-" : seasonLabel(last)}\n`,
  );

  const crawled = await crawlAniList({
    seasons,
    mediaPerSeason,
    snapshot: values["no-snapshot"] !== true,
  });
  process.stdout.write(
    `取得: 作品 ${crawled.mediaCount} 件 / 出演 ${crawled.credits.length} 件 ` +
      `(リクエスト ${crawled.requestCount} 回 / キャッシュ ${crawled.cachedCount} 回)\n`,
  );
  for (const warning of crawled.warnings) process.stderr.write(`[警告] ${warning}\n`);

  // シーズンごとに分けて送る。12 シーズンぶんをまとめると作品 1,000 件・出演 数万件になり、
  // 取り込み先が書き終える前にクライアントが諦める
  const runId = `anilist-${startedAt}`;
  const chunks = buildAniListPayloadsBySeason({
    runId,
    startedAt,
    seasons,
    media: crawled.media,
    credits: crawled.credits,
  });

  const collisions = chunks.flatMap((chunk) => chunk.collisions);
  if (collisions.length > 0) {
    // 自動で連番を振らない。振ると、どちらが /anime/{slug} なのかが走行のたびに入れ替わる
    process.stderr.write(`\n[エラー] 作品の slug が ${collisions.length} 件衝突した\n`);
    for (const collision of collisions) {
      const members = collision.members.map((member) => `${member.titleRomaji} (${member.id})`);
      process.stderr.write(`  ${collision.slug}: ${members.join(" / ")}\n`);
    }
    return 1;
  }

  const totals = {
    actors: 0,
    anime: 0,
    excludedAnime: 0,
    actorsWithoutNativeName: 0,
  };
  for (const chunk of chunks) {
    totals.actors += chunk.payload.actors.length;
    totals.anime += chunk.payload.anime.length;
    totals.excludedAnime += chunk.excludedAnime.length;
    totals.actorsWithoutNativeName += chunk.actorsWithoutNativeName;
  }
  process.stdout.write(
    `送る内容: 声優 のべ ${totals.actors} 人 / 作品 ${totals.anime} 件 ` +
      `(${chunks.length} 回に分けて送る)\n`,
  );
  if (totals.actorsWithoutNativeName > 0) {
    process.stdout.write(`  日本語表記が無く送らない: のべ ${totals.actorsWithoutNativeName} 人\n`);
  }
  if (totals.excludedAnime > 0) {
    process.stdout.write(`  ローマ字が無く送らない作品: ${totals.excludedAnime} 件\n`);
  }

  if (dryRun) {
    process.stdout.write("--dry-run なので送らずに終わる\n");
    return 0;
  }

  const client = new AdminApiClient(baseUrl ?? "", token ?? "");
  const newActors: Array<{ slug: string; canonicalName: string }> = [];
  const saved = { anime: 0, appearances: 0, newAppearances: 0, skippedActors: 0, dropped: 0 };

  for (const [index, chunk] of chunks.entries()) {
    const label = seasonLabel(seasons[index] ?? { year: 0, season: "WINTER" });
    try {
      const result = await client.ingestAniList(chunk.payload);
      newActors.push(...result.newActors);
      saved.anime += result.anime;
      saved.appearances += result.appearances;
      saved.newAppearances += result.newAppearances;
      saved.skippedActors += result.skippedActors;
      saved.dropped += result.droppedAppearances;
      process.stdout.write(
        `  ${label}: 作品 ${result.anime} 件 / 新しい声優 ${result.newActors.length} 人\n`,
      );
    } catch (error) {
      if (error instanceof IngestProtocolMismatchError) {
        // 残りも同じ結果になるので、ここで走行ごと止める
        process.stderr.write(`[エラー] ${error.message}\n`);
        return 1;
      }
      process.stderr.write(
        `[エラー] ${label} の取り込みに失敗: ` +
          `${error instanceof AdminApiError ? error.message : String(error)}\n`,
      );
      return 1;
    }
  }

  process.stdout.write(
    `取り込み: 作品 ${saved.anime} 件 / 出演 ${saved.appearances} 件 ` +
      `(うち新規 ${saved.newAppearances} 件)\n`,
  );
  process.stdout.write(`初めて見た声優: ${newActors.length} 人\n`);
  for (const actor of newActors.slice(0, 20)) {
    process.stdout.write(`  ${actor.canonicalName} (${actor.slug})\n`);
  }
  if (newActors.length > 20) {
    process.stdout.write(`  ほか ${newActors.length - 20} 人\n`);
  }
  if (saved.skippedActors > 0) {
    process.stdout.write(`ローマ字が無く足せなかった声優: ${saved.skippedActors} 人\n`);
  }
  if (saved.dropped > 0) {
    // 足せなかった声優 (ローマ字が無い) の出演がここに出る。送る側の組み立ての漏れでも
    // 同じ数に乗るので、両方を疑えるように件数だけ出す
    process.stdout.write(`声優を引き当てられず落とした出演: ${saved.dropped} 件\n`);
  }

  const outFile = asString(values["new-actors-out"]);
  if (outFile !== undefined) {
    // 後続の `crawler/run.ts --only` にそのまま渡せる形にする
    await writeFile(outFile, newActors.map((actor) => actor.slug).join(","), "utf8");
    process.stdout.write(`初めて見た声優の slug を書き出した: ${outFile}\n`);
  }

  // 取り込みが通ったら成功にする。警告は出したうえで 0 を返す。
  // 1 ページの取得に失敗しただけで失敗にすると、台帳には入ったのに後続の巡回が飛ぶ
  return 0;
}

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** 1 以上の整数。指定が無ければ既定値、読めなければ undefined */
function positiveInteger(
  value: string | boolean | undefined,
  fallback: number,
): number | undefined {
  const text = asString(value);
  if (text === undefined) return fallback;
  const parsed = Number(text);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

// 直接実行されたときだけ動かす (テストから import しても main が走らないようにするため)
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
