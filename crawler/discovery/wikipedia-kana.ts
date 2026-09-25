import { type FetchFailure, fetchText } from "../lib/fetch.ts";
import type { ActorKanaRecord } from "./actor-kana.ts";
import {
  articleTitles,
  articleUrl,
  describeKanaRejection,
  type KanaRejection,
  kanaFromArticle,
  parseArticle,
} from "./wikipedia-article.ts";

/**
 * 日本語版 Wikipedia から声優 1 人ぶんのかなを取る (取得だけ。DB には書かない)。
 *
 * 1 人につき `/wiki/<名前>` を引き、取れなければ `/wiki/<名前>_(声優)` で引き直す。
 * 誰を引くか・結果をどこへ送るかは呼び出し側 (`crawler/kana.ts`) が決める。
 *
 * サイトの制約 (robots.txt・UA・使ってよい URL) は `docs/stores/wikimedia.md`、
 * 取ってよい記事の条件は `docs/research/actor-kana-sources-2026-09-20.md`
 */

const STORE = "wikimedia";

/** 同じ失敗がこれだけ続いたら、相手の状態が変わったとみなして止める */
const CONSECUTIVE_FAILURE_LIMIT = 10;
const NOT_FOUND = 404;
const FORBIDDEN = 403;
const TOO_MANY_REQUESTS = 429;

/** 呼び出し側に止める理由を返す。403 / 429 と連続失敗は相手の状態が変わった合図 */
export type StopReason = {
  kind: "forbidden" | "rate-limited" | "consecutive-failures";
  detail: string;
};

/**
 * この 1 人の結果が、走行を止める合図かどうか。
 * 403 と 429 はこちらの取り方を相手が拒んでいる合図なので、その場で止めて人が判断する。
 * `consecutiveFailures` には、この人を含めた連続失敗数を渡す
 */
export function stopReasonFor(
  record: ActorKanaRecord,
  consecutiveFailures: number,
): StopReason | undefined {
  if (record.status !== "failed") return undefined;
  if (record.httpStatus === FORBIDDEN) {
    return { kind: "forbidden", detail: `${record.canonicalName}: ${record.reason}` };
  }
  if (record.httpStatus === TOO_MANY_REQUESTS) {
    return { kind: "rate-limited", detail: `${record.canonicalName}: ${record.reason}` };
  }
  if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
    return {
      kind: "consecutive-failures",
      detail: `${consecutiveFailures} 人続けて失敗 (最後: ${record.canonicalName} ${record.reason})`,
    };
  }
  return undefined;
}

/**
 * 1 人ぶん。`<名前>` で取れなければ `<名前>_(声優)` を引く。
 * 引き直すのは「記事が無い」ときと「記事はあるが条件を満たさない」ときの両方で、
 * 曖昧さ回避のページに当たった人の本人記事がそちらにあるため
 */
export async function fetchActorKana(
  canonicalName: string,
  options: { snapshot?: boolean },
): Promise<ActorKanaRecord> {
  let lastFailure: FetchFailure | undefined;
  let lastRejection: { title: string; pageName?: string; reason: KanaRejection } | undefined;

  for (const title of articleTitles(canonicalName)) {
    const result = await fetchText(articleUrl(title), {
      store: STORE,
      requestKey: title,
      kind: "html",
      snapshot: options.snapshot,
    });
    const fetchedAt = new Date().toISOString();

    if (!result.ok) {
      // 404 は「その記事名が無い」だけなので、次の記事名を試す
      if (result.status !== NOT_FOUND)
        return failureRecord(canonicalName, title, result, fetchedAt);
      lastFailure = result;
      continue;
    }

    const article = parseArticle(result.body);
    const outcome = kanaFromArticle({ requestedTitle: title, canonicalName, article });
    if ("kana" in outcome) {
      return {
        canonicalName,
        status: "ok",
        kana: outcome.kana,
        rawKana: outcome.raw,
        source: outcome.source,
        title,
        ...(article.pageName === undefined ? {} : { pageName: article.pageName }),
        httpStatus: result.status,
        fetchedAt,
      };
    }
    lastRejection = {
      title,
      ...(article.pageName === undefined ? {} : { pageName: article.pageName }),
      reason: outcome.rejected,
    };
  }

  const fetchedAt = new Date().toISOString();
  if (lastRejection !== undefined) {
    return {
      canonicalName,
      status: "rejected",
      title: lastRejection.title,
      ...(lastRejection.pageName === undefined ? {} : { pageName: lastRejection.pageName }),
      reason: describeKanaRejection(lastRejection.reason),
      fetchedAt,
    };
  }
  return {
    canonicalName,
    status: "not-found",
    reason: `記事が無い (${lastFailure?.reason ?? "HTTP 404"})`,
    httpStatus: NOT_FOUND,
    fetchedAt,
  };
}

function failureRecord(
  canonicalName: string,
  title: string,
  result: FetchFailure,
  fetchedAt: string,
): ActorKanaRecord {
  return {
    canonicalName,
    status: "failed",
    title,
    ...(result.status === undefined ? {} : { httpStatus: result.status }),
    reason: result.reason,
    fetchedAt,
  };
}
