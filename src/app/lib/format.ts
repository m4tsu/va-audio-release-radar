import type { WorkCategory } from "@/domain/types";

/**
 * 画面表示用のフォーマッタ。日本語 UI だけなので i18n は挟まない (企画書 §7)。
 *
 * 日時は DB から ISO 8601 文字列 / "YYYY-MM-DD" で来る。Date に通すとタイムゾーンで
 * 日付がずれるため、日付の表示は文字列のまま切り出す
 */

const integerFormat = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 });

/**
 * 価格。"¥1,584" の形にする。
 *
 * Intl の currency 書式は環境の ICU によって全角の "￥" になることがあり、
 * 見た目が揺れるので記号は自前で付ける
 */
export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `¥${integerFormat.format(Math.round(value))}`;
}

/** 再生時間。"8時間12分" / "1時間26分" / "45分" */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}分`;
  if (minutes === 0) return `${hours}時間`;
  return `${hours}時間${minutes}分`;
}

/** 発売日。"2026-09-01" → "2026年9月1日"。Date を経由しないのでタイムゾーンで日がずれない */
export function formatReleaseDate(date: string): string {
  const year = date.slice(0, 4);
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  if (!year || Number.isNaN(month) || Number.isNaN(day)) return date;
  return `${year}年${month}月${day}日`;
}

/** 日時つき。"2026-09-18T04:30:00.000Z" → "2026年9月18日 13:30" (JST 表示) */
export function formatDateTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(parsed);
}

/** 発売予定日。"2026-10-01" → "10月1日"。年は出さない (先の予定でも数か月先までしか無い) */
export function formatMonthDay(date: string): string {
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  if (Number.isNaN(month) || Number.isNaN(day)) return date;
  return `${month}月${day}日`;
}

/**
 * 前回フィードを見たとき以降に「発売された / 見つかった」作品か (設計書 §10 の未読)。
 *
 * 発売日が未来の作品まで発売日で比べると、発売日が来るまで永久に未読のままになる。
 * まだ発売していないものは「見つかった日時」で比べる (設計書 §10 の「発売 / 発見」)。
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

const CATEGORY_LABELS: Record<WorkCategory, string> = {
  asmr: "ASMR",
  audio_drama: "ボイスドラマ",
  audiobook: "朗読",
  situation_voice: "シチュエーションボイス",
  other: "その他",
};

export function categoryLabel(category: WorkCategory): string {
  return CATEGORY_LABELS[category];
}
