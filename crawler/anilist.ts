import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { crawlAniList, recentSeasons, seasonLabel } from "./discovery/anilist.ts";
import { buildAniListPayload } from "./discovery/anilist-payload.ts";
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

  const built = buildAniListPayload({
    // 取り込みの記録の主キー。同じ走行を送り直しても記録が 1 行に保たれる
    runId: `anilist-${startedAt}`,
    startedAt,
    seasons,
    media: crawled.media,
    credits: crawled.credits,
  });
  process.stdout.write(
    `送る内容: 声優 ${built.payload.actors.length} 人 / 作品 ${built.payload.anime.length} 件\n`,
  );
  if (built.actorsWithoutNativeName > 0) {
    process.stdout.write(`  日本語表記が無く送らない: ${built.actorsWithoutNativeName} 人\n`);
  }
  if (built.excludedAnime.length > 0) {
    process.stdout.write(
      `  ローマ字が無く送らない作品: ${built.excludedAnime.length} 件 ` +
        `(${built.excludedAnime
          .slice(0, 5)
          .map((item) => item.titleNative ?? `media ${item.mediaId}`)
          .join("、")})\n`,
    );
  }
  if (built.collisions.length > 0) {
    // 自動で連番を振らない。振ると、どちらが /anime/{slug} なのかが走行のたびに入れ替わる
    process.stderr.write(`\n[エラー] 作品の slug が ${built.collisions.length} 件衝突した\n`);
    for (const collision of built.collisions) {
      const members = collision.members.map((member) => `${member.titleRomaji} (${member.id})`);
      process.stderr.write(`  ${collision.slug}: ${members.join(" / ")}\n`);
    }
    return 1;
  }

  if (dryRun) {
    process.stdout.write("--dry-run なので送らずに終わる\n");
    return crawled.warnings.length > 0 ? 1 : 0;
  }

  const client = new AdminApiClient(baseUrl ?? "", token ?? "");
  let result: Awaited<ReturnType<AdminApiClient["ingestAniList"]>>;
  try {
    result = await client.ingestAniList(built.payload);
  } catch (error) {
    if (error instanceof IngestProtocolMismatchError) {
      process.stderr.write(`[エラー] ${error.message}\n`);
      return 1;
    }
    process.stderr.write(
      `[エラー] 取り込みに失敗: ${error instanceof AdminApiError ? error.message : String(error)}\n`,
    );
    return 1;
  }

  process.stdout.write(
    `取り込み: 作品 ${result.anime} 件 / 出演 ${result.appearances} 件 ` +
      `(うち新規 ${result.newAppearances} 件)\n`,
  );
  process.stdout.write(`初めて見た声優: ${result.newActors.length} 人\n`);
  for (const actor of result.newActors.slice(0, 20)) {
    process.stdout.write(`  ${actor.canonicalName} (${actor.slug})\n`);
  }
  if (result.newActors.length > 20) {
    process.stdout.write(`  ほか ${result.newActors.length - 20} 人\n`);
  }
  if (result.skippedActors > 0) {
    process.stdout.write(`ローマ字が無く足せなかった声優: ${result.skippedActors} 人\n`);
  }
  if (result.droppedAppearances > 0) {
    // 送った actors に居ない staff id を出演が指していた。送る側の組み立ての漏れなので目立たせる
    process.stderr.write(
      `[警告] 声優を引き当てられず落とした出演: ${result.droppedAppearances} 件\n`,
    );
  }
  if (result.clearedScreened > 0) {
    process.stdout.write(`辞書が増えたので、対象外の判断 ${result.clearedScreened} 件を捨てた\n`);
  }

  const outFile = asString(values["new-actors-out"]);
  if (outFile !== undefined) {
    // 後続の `crawler/run.ts --only` にそのまま渡せる形にする
    await writeFile(outFile, result.newActors.map((actor) => actor.slug).join(","), "utf8");
    process.stdout.write(`初めて見た声優の slug を書き出した: ${outFile}\n`);
  }

  return crawled.warnings.length > 0 ? 1 : 0;
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
