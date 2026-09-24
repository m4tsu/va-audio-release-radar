import { Link } from "@tanstack/react-router";
import { FollowButton } from "@/app/components/follow-button";
import { PageHeader } from "@/app/components/page-header";
import { useLocale, useT } from "@/app/i18n";
import { actorDisplayName } from "@/app/lib/actor-name";
import { animeAlternateTitle, animeDisplayTitle } from "@/app/lib/anime-title";
import { characterDisplayName } from "@/app/lib/character-name";
import { categoryLabel } from "@/app/lib/format";
import { safeHttpsUrl } from "@/app/lib/safe-url";
import { seasonLabel } from "@/app/lib/season";
import type { AnimeCastMember, AnimeDetail } from "@/app/lib/view-types";

/**
 * アニメ 1 作品のページ。
 *
 * 出すのはこの作品の出演者全員。まだ音声作品を出していない人も並べるのは、その人を
 * フォローする経路がここにしか無いため。並べる順は `getAnimeBySlug` が決めてあり、
 * ここでは並べるだけ。
 * 各行からフォローできるのは、アニメから入った人が声優ページを開かずに登録を終えられるようにするため
 */
export function AnimePage({ anime }: { anime: AnimeDetail }) {
  const t = useT();
  const locale = useLocale();
  const cover = safeHttpsUrl(anime.coverImageUrl);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start gap-4">
        {cover ? (
          <img
            src={cover}
            alt=""
            className="h-36 w-24 shrink-0 rounded-md object-cover"
            loading="lazy"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <PageHeader
            title={animeDisplayTitle(anime, locale)}
            description={<AnimeSubtitle anime={anime} />}
          />
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold text-xl tracking-tight">{t("anime.castTitle")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {anime.cast.map((member) => (
            <CastCard key={`${member.characterId}-${member.actor.id}`} member={member} />
          ))}
        </div>
      </section>
    </div>
  );
}

/** シーズンと、見出しに出していないほうのアニメ名 */
function AnimeSubtitle({ anime }: { anime: AnimeDetail }) {
  const t = useT();
  const locale = useLocale();
  return (
    <>
      {t("anime.subtitle", {
        season: seasonLabel(anime.seasonYear, anime.season, locale),
        alternate: animeAlternateTitle(anime, locale),
      })}
    </>
  );
}

/**
 * キャスト 1 行。
 *
 * 行全体をリンクにしない。フォローをこの行から行えるようにするためで、
 * ボタンをリンクの中に入れると押したときに声優ページへ移ってしまう。
 * 声優ページへは名前のリンクから行く
 */
function CastCard({ member }: { member: AnimeCastMember }) {
  const t = useT();
  const locale = useLocale();
  const characterImage = safeHttpsUrl(member.characterImageUrl);

  return (
    <div className="flex gap-3 rounded-xl border p-3">
      {characterImage ? (
        <img
          src={characterImage}
          alt=""
          className="h-20 w-14 shrink-0 rounded-md object-cover"
          loading="lazy"
        />
      ) : null}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-baseline gap-2">
          <span className="font-medium">{characterDisplayName(member, locale)}</span>
          <span className="text-muted-foreground text-xs">
            {member.role === "main" ? t("anime.roleMain") : t("anime.roleSupporting")}
          </span>
        </div>
        <p className="text-sm">
          <Link to="/voice-actors/$slug" params={{ slug: member.actor.slug }} className="link-text">
            {actorDisplayName(member.actor, locale)}
          </Link>
        </p>
        <p className="text-muted-foreground text-xs">
          {member.workCounts.length === 0
            ? t("anime.noAudioWorksYet")
            : member.workCounts
                .map((item) =>
                  t("anime.workCount", {
                    category: categoryLabel(item.category, locale),
                    count: item.count,
                  }),
                )
                .join(t("common.slashSeparator"))}
        </p>
        <FollowButton
          actor={{
            voiceActorId: member.actor.id,
            slug: member.actor.slug,
            canonicalName: member.actor.canonicalName,
            ...(member.actor.nameEn ? { nameEn: member.actor.nameEn } : {}),
          }}
        />
      </div>
    </div>
  );
}
