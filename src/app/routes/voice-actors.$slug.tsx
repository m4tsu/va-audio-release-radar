import { createFileRoute, notFound } from "@tanstack/react-router";
import { createTranslator } from "@/app/i18n";
import { actorDisplayName } from "@/app/lib/actor-name";
import { safeHttpsUrl } from "@/app/lib/safe-url";
import type { ActorDetail } from "@/app/lib/view-types";
import { readWorkFilters, type WorkFilters, workFilterSearch } from "@/app/lib/work-filters";
import { hasAnyWork, VoiceActorPage } from "@/app/pages/voice-actor";
import { fetchActorBySlug, fetchActorStoreCoverage } from "@/app/server-fns/actors";
import { fetchAnimeByActor } from "@/app/server-fns/anime";
import { fetchPushConfig } from "@/app/server-fns/push";
import { siteOriginForLoader } from "@/app/server-fns/site";
import { fetchWorkStatsForActors, fetchWorksByActor } from "@/app/server-fns/works";

/**
 * 一覧に出す作品数。新着を追うのが目的なので過去分は打ち切る。
 * 切った先にある作品も見出しの下の作品数には入る (`fetchWorkStatsForActors`)
 */
const WORKS_PER_ACTOR = 90;

/**
 * 声優ページに出す出演アニメの上限。本人の識別 (「この人どのキャラの人だっけ」) が目的なので、
 * 全出演歴は並べない。並べるとアニメのキャスト DB になり、docs/product.md の「作らないもの」の線を越える
 */
const ANIME_PER_ACTOR = 8;

/** 声優ページ。画面は `@/app/pages/voice-actor` */
export const Route = createFileRoute("/voice-actors/$slug")({
  /**
   * ストア・区分・出演形態の絞り込み。URL に置くので、絞った画面を再読み込みしても
   * 共有しても同じ結果になる。
   *
   * 既定と読めない値では欄を返さない。ここで返した欄はルーターがハイドレーション時に
   * URL へ書き戻すので、既定値を返すと素の URL が `?appearance=all` に化け、
   * head() が出す canonical (欄なし) と食い違う。
   * 親のルートは検索文字列を素通しするため、読めない値は欄を返さないだけでは消えない。
   * 画面に渡す前に `RouteComponent` が読み直す
   */
  validateSearch: (search: Record<string, unknown>) => workFilterSearch(readWorkFilters(search)),
  // 作品一覧は絞り込みに関わらず引き、絞るのは画面側。loader が検索文字列に依存しないので
  // 絞り込みを変えても取り直しが起きない
  loader: async ({ params }) => {
    // canonical を絶対 URL にするためのオリジン。head() からは読めないのでここで解決する
    const [actor, origin] = await Promise.all([
      fetchActorBySlug({ data: { slug: params.slug } }),
      siteOriginForLoader(),
    ]);
    if (!actor) throw notFound();

    const [works, statsRows, anime, coverage, { vapidPublicKey }] = await Promise.all([
      fetchWorksByActor({ data: { voiceActorId: actor.id, limit: WORKS_PER_ACTOR } }),
      fetchWorkStatsForActors({ data: { voiceActorIds: [actor.id] } }),
      fetchAnimeByActor({ data: { voiceActorId: actor.id, limit: ANIME_PER_ACTOR } }),
      fetchActorStoreCoverage({ data: { voiceActorId: actor.id } }),
      // フォローした直後に通知の案内を出すための公開鍵 (`routes/following.tsx` と同じ)
      fetchPushConfig(),
    ]);
    // 作品を 1 件も持たない声優は行が返らない
    const stats = statsRows[0] ?? { voiceActorId: actor.id, workCount: 0 };

    // 音声作品も出演アニメも無ければ、名前しか出せるものが無い。200 で返すと中身の無い
    // ページになるので 404 にする。声優そのものは `getActorBySlug` が返し続ける (管理用)
    if (!hasAnyWork(works) && anime.length === 0) throw notFound();

    return { actor, works, stats, anime, coverage, origin, vapidPublicKey };
  },
  head: ({ loaderData, params, match }) => {
    const actor = loaderData?.actor;
    if (!actor) return {};

    const locale = match.context.locale;
    const t = createTranslator(locale);
    // 声優名はデータそのもの。訳さず、英語表示で name_en があればそちらを出す
    const name = actorDisplayName(actor, locale);
    const title = t("actor.metaTitle", { name });
    const description = t("actor.metaDescription", { name });
    const canonical = absoluteUrl(loaderData?.origin, `/voice-actors/${params.slug}`);

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "profile" },
        { property: "og:url", content: canonical },
        // 音声作品がまだ 1 件も無いページは、出せるのが名前と出演アニメだけ。
        // フォローの入口としては要るが、検索結果に並べても読む中身が無いので載せない。
        // sitemap 側も同じ条件で外している (`sitemapEntries`)
        ...(hasAnyWork(loaderData?.works ?? [])
          ? []
          : [{ name: "robots", content: "noindex" } as const]),
      ],
      links: [{ rel: "canonical", href: canonical }],
      scripts: [
        {
          type: "application/ld+json",
          children: toJsonLdScript(personJsonLd(actor, canonical)),
        },
      ],
    };
  },
  component: RouteComponent,
});

/**
 * 検索エンジンに「この URL は人物のページ」と伝える (実体クエリでの流入狙い)。
 * name は表示言語に関わらず canonicalName のまま。構造化データは実体の正規表記を出す場所で、
 * 画面の表示言語で揺らすものではない
 */
function personJsonLd(actor: ActorDetail, url: string) {
  const alternateName = actor.aliases.map((alias) => alias.name);
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: actor.canonicalName,
    url,
    ...(actor.nameKana ? { additionalName: actor.nameKana } : {}),
    ...(alternateName.length > 0 ? { alternateName } : {}),
    ...(actor.imageUrl ? { image: safeHttpsUrl(actor.imageUrl) } : {}),
  };
}

/**
 * JSON-LD を `<script>` の中身として安全な文字列にする。
 *
 * 中身は声優名・別名という外部由来の文字列で、`JSON.stringify` は `<` をそのまま残す。
 * `</script>` が含まれるとそこでスクリプト要素が閉じ、後続が HTML として解釈される。
 * `<` を `<` に置き換えれば JSON としての意味は変わらないまま閉じられなくなる
 */
function toJsonLdScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** オリジンが取れていれば絶対 URL、取れていなければ相対パスのまま出す */
function absoluteUrl(origin: string | undefined, path: string): string {
  return origin ? `${origin}${path}` : path;
}

function RouteComponent() {
  const { actor, works, stats, anime, coverage, vapidPublicKey } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // 親のルートが素通しした値がここまで来る。型は絞り込みの値でも、中身は URL の文字列そのもの
  const filters: WorkFilters = readWorkFilters(search);

  return (
    <VoiceActorPage
      actor={actor}
      works={works}
      stats={stats}
      anime={anime}
      coverage={coverage}
      vapidPublicKey={vapidPublicKey}
      filters={filters}
      onFiltersChange={(next) => {
        // 絞り込みの変更で履歴を積むと、戻るボタンが選び直した回数だけ必要になる。
        // 共有できる URL は replace でも同じものが残る。
        // 既定に戻した軸は欄ごと消し、絞っていない画面の URL を 1 つに保つ
        void navigate({ search: workFilterSearch(next), replace: true });
      }}
    />
  );
}
