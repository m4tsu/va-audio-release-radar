import { DEFAULT_LOCALE, type Locale, translate } from "@/app/i18n";
import type { WorkCategory } from "@/domain/types";

/**
 * 画面表示用のフォーマッタ。
 *
 * 表示言語は呼び出し側から渡す。既定は日本語なので、言語を渡さない呼び出しは
 * これまでと同じ結果になる (`useLocale()` を取れない場所からも呼べるようにするため)。
 *
 * 日時は DB から ISO 8601 文字列 / "YYYY-MM-DD" で来る。Date に通すとタイムゾーンで
 * 日付がずれるため、日付は必ず UTC 固定で組み立てて UTC のまま書式にする
 */

const INTL_LOCALES: Record<Locale, string> = { ja: "ja-JP", en: "en-US" };

/** 再生時間。"8時間12分" / "45分" / "8 hr 12 min" / "45 min" */
export function formatDuration(seconds: number, locale: Locale = DEFAULT_LOCALE): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return translate(locale, "format.durationMinutes", { minutes });
  if (minutes === 0) return translate(locale, "format.durationHours", { hours });
  return translate(locale, "format.durationHoursMinutes", { hours, minutes });
}

/**
 * "YYYY-MM-DD" を UTC の Date にする。Date のコンストラクタに文字列を渡すと
 * 実行環境のタイムゾーンで解釈されて前日になることがあるため、数値から組み立てる
 */
function utcDateFromIsoDate(date: string): Date | undefined {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return undefined;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return new Date(Date.UTC(year, month - 1, day));
}

/** 発売日。"2026-09-01" → "2026年9月1日" / "September 1, 2026" */
export function formatReleaseDate(date: string, locale: Locale = DEFAULT_LOCALE): string {
  const parsed = utcDateFromIsoDate(date);
  if (parsed === undefined) return date;
  if (locale === "ja") {
    // Intl の ja-JP は "2026/9/1" になる。従来の和風表記を保つため自前で組む
    return `${parsed.getUTCFullYear()}年${parsed.getUTCMonth() + 1}月${parsed.getUTCDate()}日`;
  }
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

/** 日時つき。"2026-09-18T04:30:00.000Z" → "2026年9月18日 13:30" (JST 表示) */
export function formatDateTime(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  // 扱う作品は日本のストアのものなので、言語を問わず JST で読ませる
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(parsed);
}

/** 発売予定日。"2026-10-01" → "10月1日" / "Oct 1"。年は出さない (先の予定でも数か月先までしか無い) */
export function formatMonthDay(date: string, locale: Locale = DEFAULT_LOCALE): string {
  const parsed = utcDateFromIsoDate(date);
  if (parsed === undefined) return date;
  if (locale === "ja") return `${parsed.getUTCMonth() + 1}月${parsed.getUTCDate()}日`;
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

/**
 * 前回フィードを見たとき以降に「発売された / 見つかった」作品か (未読の判定)。
 *
 * 発売日が未来の作品まで発売日で比べると、発売日が来るまで永久に未読のままになる。
 * まだ発売していないものは「見つかった日時」で比べる。
 * `lastSeenFeedAt` が無い = このブラウザで初めて見るときは、全件に印が付くのを避けて何も出さない
 */
export function isUnreadSince(
  work: { releaseDate?: string },
  firstSeenAt: string | undefined,
  lastSeenFeedAt: string | null,
  now: string = new Date().toISOString(),
): boolean {
  if (!lastSeenFeedAt) return false;
  // 発売日は日付だけなので、その日の始まり (UTC) として比べる
  const released = work.releaseDate ? `${work.releaseDate}T00:00:00.000Z` : undefined;
  if (released && released <= now && released > lastSeenFeedAt) return true;
  return firstSeenAt !== undefined && firstSeenAt > lastSeenFeedAt;
}

/**
 * 作品の区分の表示名。ストアの売り場名ではなくこちらで正規化した自前の区分なので、
 * 表示言語に合わせて訳す (辞書の `category.*`)
 */
export function categoryLabel(category: WorkCategory, locale: Locale = DEFAULT_LOCALE): string {
  return translate(locale, `category.${category}`);
}

/**
 * 問い合わせ窓口 (`CONTACT_URL`) をリンクの文字列にする。
 * `mailto:` はアドレスだけを見せる。scheme を出しても読み手の役に立たない
 */
export function contactLinkLabel(url: string): string {
  return url.startsWith("mailto:") ? url.slice("mailto:".length) : url;
}
