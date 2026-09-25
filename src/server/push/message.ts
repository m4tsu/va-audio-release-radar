import type { Locale } from "@/domain/types";

/**
 * ダイジェスト通知の本文。service worker (`public/sw.js`) が受け取る形。
 *
 * 文言をここに持つのは、画面の辞書 (`src/app/i18n`) をサーバー側から読めないため
 * (依存の向きは src/app → src/server)。通知に載る文はこの 2 文だけなので、辞書と同じ仕組みは要らない。
 *
 * 作品名は入れない。声優名と件数で「見に行く価値があるか」は伝わり、作品名は長くて切れる。
 * ストアへの直リンクも入れない。送客はサイトの作品ページ経由で数える (`docs/product.md` の「製品」にある指標)
 */

export type PushMessage = {
  title: string;
  body: string;
  /** 開く先。フォロー一覧。相対 URL のまま渡し、service worker が自分のオリジンで解く */
  url: string;
};

export type DigestActor = {
  canonicalName: string;
  nameEn?: string | null;
};

/** 本文に名前で並べる人数。それを超えた分は「ほか N 人」に畳む */
const NAMED_ACTORS = 3;

const FOLLOWING_URL = "/following";

export function digestMessage(
  locale: Locale,
  workCount: number,
  actors: DigestActor[],
): PushMessage {
  const named = actors.slice(0, NAMED_ACTORS).map((actor) => actorName(actor, locale));
  const rest = actors.length - named.length;
  return locale === "en"
    ? {
        title: workCount === 1 ? "1 new audio work" : `${workCount} new audio works`,
        body: englishBody(named, rest),
        url: FOLLOWING_URL,
      }
    : {
        title: `新作の音声作品 ${workCount} 件`,
        body: japaneseBody(named, rest),
        url: FOLLOWING_URL,
      };
}

/**
 * 管理 API から送る試しの 1 通。送信の経路 (暗号化・署名・push service・service worker) が
 * 通るかだけを見るので、新作の有無に関係なく同じ文を出す
 */
export function testMessage(locale: Locale): PushMessage {
  return locale === "en"
    ? {
        title: "Test notification",
        body: "If you can see this, notifications work",
        url: FOLLOWING_URL,
      }
    : {
        title: "通知のテスト",
        body: "この通知が見えていれば、通知は届いています",
        url: FOLLOWING_URL,
      };
}

function actorName(actor: DigestActor, locale: Locale): string {
  return locale === "en" && actor.nameEn ? actor.nameEn : actor.canonicalName;
}

function japaneseBody(named: string[], rest: number): string {
  const names = named.join("、");
  return rest > 0 ? `${names} ほか ${rest} 人の新作が出ました` : `${names}の新作が出ました`;
}

function englishBody(named: string[], rest: number): string {
  if (rest > 0) return `New from ${named.join(", ")} and ${rest} more`;
  if (named.length <= 1) return `New from ${named.join("")}`;
  return `New from ${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}
