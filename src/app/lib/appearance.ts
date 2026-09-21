import { DEFAULT_LOCALE, type Locale, translate } from "@/app/i18n";

/**
 * 作品の出演形態。「その声優の声をどれだけ聴けるか」の目安で、判定に使うのは
 * 保存済みクレジットの人数 (`castSize`) だけ。
 *
 * `docs/product.md` の「差別化の軸」は全編朗読も挙げているが、ここでは判定しない。
 * 保存済みのデータに「その声優が 1 人で全編を読んでいるか」を決める手がかりが無いため。
 * `audio_works.category` の朗読はストアの売り場の区分で、複数人で読む作品も入る。
 * 推測で埋めた区分を混ぜると、絞り込んだ結果を信用できなくなる
 */
export const APPEARANCE_FORMATS = ["solo", "small", "large", "unknown"] as const;
export type AppearanceFormat = (typeof APPEARANCE_FORMATS)[number];

/**
 * 「少人数」に入る人数の上限。これを超えると「大人数」。
 *
 * 4 なのは、ここまでなら誰が出ていても 1 人あたりの分量が見当を付けられるため。
 * 5 人以上はアンソロジーや合同企画で、目当ての声優が全編に出るのか 1 編だけなのかが
 * 作品ごとに変わり、人数から分量を読めなくなる
 */
const SMALL_CAST_MAX = 4;

/** クレジットの人数から出演形態を決める。0 件 (取れていない) は推測せず「不明」 */
export function appearanceFormat(castSize: number): AppearanceFormat {
  if (!Number.isFinite(castSize) || castSize <= 0) return "unknown";
  if (castSize === 1) return "solo";
  return castSize <= SMALL_CAST_MAX ? "small" : "large";
}

/** 出演形態の表示名。こちらで決めた区分なので表示言語に合わせて訳す (辞書の `appearance.*`) */
export function appearanceLabel(format: AppearanceFormat, locale: Locale = DEFAULT_LOCALE): string {
  return translate(locale, `appearance.${format}`);
}

/**
 * 絞り込みの選択肢。`all` は絞り込まない。
 *
 * 「不明」を選択肢に出さないのは、クレジットが取れていないことであって出演形態ではないため。
 * 判定しない区分 (全編朗読) も出さない
 */
export const APPEARANCE_FILTERS = ["all", "solo", "small", "large"] as const;
export type AppearanceFilter = (typeof APPEARANCE_FILTERS)[number];
export const DEFAULT_APPEARANCE_FILTER: AppearanceFilter = "all";

export function isAppearanceFilter(value: string): value is AppearanceFilter {
  return (APPEARANCE_FILTERS as readonly string[]).includes(value);
}

/** この作品が絞り込みに残るか */
export function matchesAppearance(filter: AppearanceFilter, castSize: number): boolean {
  return filter === "all" || appearanceFormat(castSize) === filter;
}
