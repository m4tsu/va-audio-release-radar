import { type FetchResult, fetchText } from "../lib/fetch.ts";
import type { ActorKanaRecord } from "./actor-kana.ts";
import { toStoredKana } from "./kana-text.ts";
import { entityUrl, isEntityId, kanaClaims } from "./wikidata-entity.ts";
import {
  articleUrl,
  describeKanaRejection,
  kanaFromArticle,
  parseArticle,
} from "./wikipedia-article.ts";

/**
 * 「記事には辿り着いたが読みが書かれていなかった」人の記事を引き直し、
 * 記事の導入部と Wikidata から読みを埋める (取得だけ。DB には書かない)。
 *
 * この人たちは `kanaFromArticle` の 3 条件 (記事名が一致する / 曖昧さ回避でない /
 * 声優のカテゴリを持つ) を通っており、**記事が本人のものであることが確認済み**で、
 * 足りないのは読みだけ。他の理由で落ちた人は、記事が本人のものかを機械で確かめられないので引かない。
 * どの人をここへ回すかは呼び出し側 (`crawler/kana.ts`) が `NO_KANA_REASON` で決める。
 *
 * サイトの制約 (robots.txt・UA・使ってよい URL) は `docs/stores/wikimedia.md`
 */

const STORE = "wikimedia";
const NOT_FOUND = 404;

/** 引き直す対象。`wikipedia-kana.ts` がこの理由で残した人だけを引き直す */
export const NO_KANA_REASON = describeKanaRejection("no-kana");
/** 引き直しても読みが無かった人。対象の理由と別の文字列にして、導入部と Wikidata まで見たことを残す */
export const REFILLED_NO_KANA_REASON = "読みが記事にも Wikidata にも無い";
/** 導入部に読みが無く、Wikidata へ辿る項目 id も記事に無い人。項目 id が無ければ項目は引けない */
export const NO_ENTITY_REASON = "読みが記事に無く、Wikidata の項目 id も記事に無い";

function failureRecord(
  base: ActorKanaRecord,
  result: Extract<FetchResult, { ok: false }>,
  reason: string,
): ActorKanaRecord {
  // 残すのは失敗した取得のステータスだけ。記事が 200 でも項目で失敗したなら 200 を残さない
  const { httpStatus: _replaced, ...rest } = base;
  return {
    ...rest,
    status: "failed",
    ...(result.status === undefined ? {} : { httpStatus: result.status }),
    reason,
  };
}

/**
 * 1 人ぶん。記事を引き直し、導入部 → Wikidata の順に読みを探す。
 *
 * 記事はもう一度 3 条件で確かめる。前回引いてから転送やカテゴリが変わっていることがあり、
 * 確かめ直さずに読みだけ取ると、本人のものでない記事から取ることになる
 */
export async function refillActorKana(
  target: ActorKanaRecord,
  options: { snapshot?: boolean },
): Promise<ActorKanaRecord> {
  const { canonicalName } = target;
  const title = target.title;
  if (title === undefined) {
    return {
      canonicalName,
      status: "failed",
      reason: "引き直す記事名が結果に無い",
      fetchedAt: new Date().toISOString(),
    };
  }

  const article = await fetchText(articleUrl(title), {
    store: STORE,
    requestKey: title,
    kind: "html",
    snapshot: options.snapshot,
  });
  if (!article.ok) {
    // 404 は「その記事はもう無い」という答えであって、こちらの取得の失敗ではない。
    // 失敗として残すと、記事が消えた人が並んだだけで連続失敗の打ち切りに当たる
    if (article.status === NOT_FOUND) {
      return {
        canonicalName,
        status: "not-found",
        title,
        httpStatus: NOT_FOUND,
        reason: `引き直す記事が無くなった (${article.reason})`,
        fetchedAt: new Date().toISOString(),
      };
    }
    return failureRecord(
      { canonicalName, status: "failed", title, fetchedAt: new Date().toISOString() },
      article,
      `記事を引き直せない (${article.reason})`,
    );
  }

  const parsed = parseArticle(article.body);
  const base: ActorKanaRecord = {
    canonicalName,
    status: "rejected",
    title,
    ...(parsed.pageName === undefined ? {} : { pageName: parsed.pageName }),
    ...(parsed.wikibaseItemId === undefined ? {} : { wikibaseItemId: parsed.wikibaseItemId }),
    httpStatus: article.status,
    fetchedAt: new Date().toISOString(),
  };

  const outcome = kanaFromArticle({ requestedTitle: title, canonicalName, article: parsed });
  if ("kana" in outcome) {
    return {
      ...base,
      status: "ok",
      kana: outcome.kana,
      rawKana: outcome.raw,
      source: outcome.source,
    };
  }
  if (outcome.rejected !== "no-kana") {
    return { ...base, reason: describeKanaRejection(outcome.rejected) };
  }

  if (parsed.leadReading !== undefined) {
    const kana = toStoredKana(parsed.leadReading);
    if (kana !== undefined) {
      return { ...base, status: "ok", kana, rawKana: parsed.leadReading, source: "lead" };
    }
  }

  const itemId = parsed.wikibaseItemId;
  // 名前から項目を引く経路は robots.txt で塞がれている。記事に id が無ければそこで終わり
  if (itemId === undefined || !isEntityId(itemId)) {
    return { ...base, reason: NO_ENTITY_REASON };
  }

  const entity = await fetchText(entityUrl(itemId), {
    store: STORE,
    requestKey: itemId,
    kind: "html",
    snapshot: options.snapshot,
  });
  if (!entity.ok) {
    return failureRecord(
      { ...base, status: "failed", fetchedAt: new Date().toISOString() },
      entity,
      `Wikidata の項目を引けない (${entity.reason})`,
    );
  }

  const fetchedAt = new Date().toISOString();
  for (const claim of kanaClaims(entity.body)) {
    const kana = toStoredKana(claim);
    if (kana !== undefined) {
      return { ...base, status: "ok", kana, rawKana: claim, source: "wikidata", fetchedAt };
    }
  }
  return { ...base, reason: REFILLED_NO_KANA_REASON, fetchedAt };
}
