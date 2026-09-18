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

/** NEW バッジを出す日数。企画書 §6 の「今週の新着」に合わせて 7 日 */
export const NEW_WORK_DAYS = 7;

/**
 * 新着扱いかどうか。発売日があればそれを、無ければストアで最初に見つけた日時で判定する。
 * DLsite の一覧には発売日が載らない作品があるため、初出でも救えるようにしてある
 */
export function isNewWork(
  work: { releaseDate?: string },
  firstSeenAt: string | undefined,
  now: number = Date.now(),
): boolean {
  const threshold = now - NEW_WORK_DAYS * 24 * 60 * 60 * 1000;
  // 発売日は日付だけなので、その日の始まり (UTC) として比べる
  const basis = work.releaseDate ? Date.parse(`${work.releaseDate}T00:00:00Z`) : undefined;
  if (basis !== undefined && !Number.isNaN(basis)) return basis >= threshold;
  if (!firstSeenAt) return false;
  const seen = Date.parse(firstSeenAt);
  return !Number.isNaN(seen) && seen >= threshold;
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
