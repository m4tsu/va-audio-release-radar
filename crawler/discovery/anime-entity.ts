/**
 * アニメの slug と役の規則。
 *
 * ここは fetch も fs も触らない。取り込みに送る形を組み立てる `anilist-payload.ts` が使う。
 * slug は URL に出て後から変えられないので、規則を単体テストで固定しておく
 */

export type AnimeRole = "main" | "supporting";

/** 同じ slug になった 2 作品以上。生成を失敗させて人に判断させるための材料 */
export type AnimeSlugCollision = {
  slug: string;
  members: Array<{ id: string; titleRomaji: string }>;
};

// --- slug ------------------------------------------------------------------

/**
 * ローマ字タイトル ("Sousou no Frieren") を slug ("sousou-no-frieren") にする。
 *
 * 英数字以外はすべて区切りとして扱う。コロンや中黒 ("Made in Abyss: Mezameru Shinpi") が
 * URL に出ると読みにくく、エスケープの有無で同じページが二重に見えるため。
 * 記号だけで中身が残らない場合は undefined を返す
 */
export function toAnimeSlug(titleRomaji: string | undefined): string | undefined {
  if (titleRomaji === undefined) return undefined;
  const slug = titleRomaji
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? undefined : slug;
}

// --- 役 --------------------------------------------------------------------

/**
 * AniList の role を保存する値にする。
 *
 * MAIN / SUPPORTING 以外 (BACKGROUND など) は undefined を返し、出演そのものを捨てる。
 * 名前のあるキャラクターを演じたとは限らず、画面に出す価値が無いため
 */
export function toAnimeRole(role: string | undefined): AnimeRole | undefined {
  switch (role) {
    case "MAIN":
      return "main";
    case "SUPPORTING":
      return "supporting";
    default:
      return undefined;
  }
}

/**
 * 同じ slug になった作品を集める。
 *
 * 見つかっても `-2` のような連番は振らない。どちらが `/anime/{slug}` なのかが
 * 実行のたびに入れ替わり、別作品の出演者が混ざる。どちらを正とするかは人が決める
 * (声優 slug と同じ方針。`src/domain/actor-slug.ts`)
 */
export function findAnimeSlugCollisions(
  anime: readonly { id: string; slug: string; titleRomaji: string }[],
): AnimeSlugCollision[] {
  const bySlug = new Map<string, Array<{ id: string; slug: string; titleRomaji: string }>>();
  for (const item of anime) {
    const group = bySlug.get(item.slug);
    if (group) group.push(item);
    else bySlug.set(item.slug, [item]);
  }

  const collisions: AnimeSlugCollision[] = [];
  for (const [slug, group] of bySlug) {
    if (group.length < 2) continue;
    collisions.push({
      slug,
      members: group.map((item) => ({ id: item.id, titleRomaji: item.titleRomaji })),
    });
  }
  return collisions;
}
