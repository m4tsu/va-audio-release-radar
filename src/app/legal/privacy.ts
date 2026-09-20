import type { LocalizedLegalDocument } from "./index";

/**
 * プライバシーポリシー。条の id と並びは両言語で同じにする (`legal.test.ts`)。
 *
 * 「何をどこに保存し、何をどこへ送るか」は実装に合わせてある。変えたらここも直すこと:
 * - ブラウザ内の保存: `src/app/store/follow-store.ts` (IndexedDB)、`src/app/server-fns/locale.ts` (cookie)、
 *   `src/app/hooks/use-theme.ts` (localStorage)
 * - サーバーへ送るもの: `src/app/server-fns/works.ts` の `fetchFeed` (フォロー中の声優 ID)
 * - 外部サーバーから読むもの: `src/app/components/work-card.tsx` の表紙画像
 * - アクセスログ: `wrangler.jsonc` の `observability`
 */
export const privacy: LocalizedLegalDocument = {
  ja: {
    effectiveDate: "2026-09-19",
    sections: [
      {
        id: "overview",
        heading: "1. 基本方針",
        blocks: [
          {
            type: "paragraph",
            text: "Koenect (以下「本サービス」) の運営者 (以下「運営者」) は、本サービスの利用者の情報を次のとおり扱います。",
          },
          {
            type: "paragraph",
            text: "本サービスにはアカウントの登録がありません。氏名、メールアドレス、パスワードなど利用者を特定する情報を入力する機能は無く、運営者はそれらを取得しません。",
          },
        ],
      },
      {
        id: "browser",
        heading: "2. 利用者のブラウザに保存する情報",
        blocks: [
          {
            type: "paragraph",
            text: "本サービスは、次の情報を利用者のブラウザにのみ保存します。これらは利用者のブラウザから消去でき、他の端末には引き継がれません。",
          },
          {
            type: "list",
            items: [
              "フォローした声優 (声優の ID、名前、フォローした日時) と、フォロー中の新着を最後に表示した日時。ブラウザのデータベース (IndexedDB) に保存し、フォロー中の新着の表示と未読の印に使います。",
              "表示言語の選択。Cookie に 1 年間保存し、ページを開いたときの言語を決めるために使います。",
              "配色 (ライト / ダーク) の選択。ブラウザのローカルストレージに保存し、ページを開いたときの配色を決めるために使います。",
            ],
          },
          {
            type: "paragraph",
            text: "このほか、運営者が管理画面を開くときにだけ使う Cookie がありますが、利用者のブラウザに発行されることはありません。",
          },
        ],
      },
      {
        id: "server",
        heading: "3. 本サービスのサーバーに送られる情報",
        blocks: [
          {
            type: "list",
            items: [
              "フォロー中の新着を表示するとき、フォローしている声優の ID がサーバーに送られます。サーバーはその場で新着を返すだけで、送られた ID を保存しません。",
              "表示言語の Cookie は、ページを取得するたびにサーバーへ送られ、その言語でページを作るために使われます。",
              "本サービスは Cloudflare, Inc. の Cloudflare Workers 上で動作しています。ページの取得に伴い、IP アドレス、ブラウザの種類 (User-Agent)、取得した URL、日時などが Cloudflare のアクセスログに一定期間記録されます。運営者はこれを、本サービスの安定した運用と障害の調査のためにのみ使い、それ以外の目的で利用者を特定することはありません。Cloudflare における取り扱いは Cloudflare のプライバシーポリシーに従います。",
            ],
          },
        ],
      },
      {
        id: "third-party",
        heading: "4. 外部サービスへの通信",
        blocks: [
          {
            type: "list",
            items: [
              "作品の表紙画像は、各販売サイト (DLsite、Audible、ポケットドラマCD) のサーバーから直接読み込みます。そのため、ページを表示すると利用者のブラウザから各販売サイトのサーバーへ通信が発生し、IP アドレスなどが各販売サイトに送られます。各販売サイトにおける取り扱いは、それぞれのプライバシーポリシーに従います。",
              "作品ページからのリンクは各販売サイトへ移動します。リンクにはアフィリエイト用の識別子が含まれることがあり、その場合、移動先の販売サイトが本サービスから移動したことを記録します。",
              "本サービスは、アクセス解析ツールや広告配信のためのタグ、SNS の埋め込みを使用していません。",
            ],
          },
        ],
      },
      {
        id: "published",
        heading: "5. 本サービスに掲載する第三者の情報",
        blocks: [
          {
            type: "paragraph",
            text: "本サービスは、声優の名前、出演アニメ、出演した音声作品といった情報を掲載します。これらは各販売サイトの公開ページと、アニメ情報サイト AniList の公開 API から取得したものであり、いずれも公表されている情報です。運営者が独自に取材した情報や、非公開の情報は含みません。",
          },
          {
            type: "paragraph",
            text: "声優本人またはその所属事務所から掲載内容の訂正や削除の申し出があった場合、運営者は内容を確認し、合理的な期間内に対応します。申し出の方法は利用規約に定めます。",
          },
        ],
      },
      {
        id: "changes",
        heading: "6. 本ポリシーの変更",
        blocks: [
          {
            type: "paragraph",
            text: "運営者は、本サービスの機能の追加や法令の変更に応じて本ポリシーを変更することがあります。変更後の本ポリシーは、本サービス上に掲載した時点から効力を生じます。ブラウザの外へ新たに情報を送る機能 (通知など) を追加する場合は、本ポリシーを改めてから提供します。",
          },
        ],
      },
      {
        id: "contact",
        heading: "7. お問い合わせ",
        blocks: [
          {
            type: "contact",
            withUrl: "本ポリシーに関するお問い合わせは、次の窓口で受け付けます。",
            withoutUrl: "本ポリシーに関するお問い合わせ窓口は、本サービス上で案内します。",
          },
        ],
      },
    ],
  },

  en: {
    effectiveDate: "2026-09-19",
    sections: [
      {
        id: "overview",
        heading: "1. Overview",
        blocks: [
          {
            type: "paragraph",
            text: 'The operator (the "Operator") of Koenect (the "Service") handles information about Users of the Service as described below.',
          },
          {
            type: "paragraph",
            text: "The Service has no user accounts. There is no feature for entering a name, email address, password or other information that identifies you, and the Operator does not collect such information.",
          },
        ],
      },
      {
        id: "browser",
        heading: "2. Information stored in your browser",
        blocks: [
          {
            type: "paragraph",
            text: "The Service stores the following information only in your browser. You can clear it from your browser, and it is not carried over to other devices.",
          },
          {
            type: "list",
            items: [
              "The voice actors you follow (their ID, name and the time you followed them) and the time you last viewed the feed of new releases. These are stored in the browser's database (IndexedDB) and used to show the feed and mark unread items.",
              "Your language choice. This is stored in a cookie for one year and used to decide which language to render pages in.",
              "Your color scheme choice (light or dark). This is stored in the browser's local storage and used to decide which scheme to render pages in.",
            ],
          },
          {
            type: "paragraph",
            text: "There is also a cookie used only when the Operator opens the administrative pages. It is never issued to Users' browsers.",
          },
        ],
      },
      {
        id: "server",
        heading: "3. Information sent to the Service's servers",
        blocks: [
          {
            type: "list",
            items: [
              "When the feed of new releases is shown, the IDs of the voice actors you follow are sent to the server. The server only returns the matching releases and does not store the IDs it receives.",
              "The language cookie is sent to the server with each page request and used to render the page in that language.",
              "The Service runs on Cloudflare Workers, operated by Cloudflare, Inc. When pages are requested, your IP address, browser type (User-Agent), the requested URL, the time and similar details are recorded in Cloudflare's access logs for a limited period. The Operator uses these logs only to keep the Service running reliably and to investigate failures, and does not use them to identify Users for any other purpose. Cloudflare's handling of this data is governed by Cloudflare's privacy policy.",
            ],
          },
        ],
      },
      {
        id: "third-party",
        heading: "4. Connections to third-party services",
        blocks: [
          {
            type: "list",
            items: [
              "Cover images are loaded directly from the servers of each store (DLsite, Audible, Pocket Drama CD). Displaying a page therefore causes your browser to connect to those servers, which receive your IP address and similar details. Each store's handling of this data is governed by its own privacy policy.",
              "Links on work pages lead to the stores. A link may include an affiliate identifier, in which case the store records that you arrived from the Service.",
              "The Service does not use analytics tools, advertising tags or social media embeds.",
            ],
          },
        ],
      },
      {
        id: "published",
        heading: "5. Third-party information listed on the Service",
        blocks: [
          {
            type: "paragraph",
            text: "The Service lists information such as voice actors' names, the anime they appear in and the audio works they appear in. This information is collected from pages that each store makes public and from the public API of the anime database AniList, and is already publicly available. It does not include information the Operator gathered independently or that is not public.",
          },
          {
            type: "paragraph",
            text: "If a voice actor or their agency asks for listed content to be corrected or removed, the Operator will review the request and respond within a reasonable period. How to make such a request is set out in the Terms of Service.",
          },
        ],
      },
      {
        id: "changes",
        heading: "6. Changes to this policy",
        blocks: [
          {
            type: "paragraph",
            text: "The Operator may change this policy when features are added to the Service or when the law changes. The revised policy takes effect when posted on the Service. If a feature that sends information outside your browser (such as notifications) is added, this policy will be revised before the feature is offered.",
          },
        ],
      },
      {
        id: "contact",
        heading: "7. Contact",
        blocks: [
          {
            type: "contact",
            withUrl: "Questions about this policy can be sent to the following contact point.",
            withoutUrl:
              "A contact point for questions about this policy will be announced on the Service.",
          },
        ],
      },
    ],
  },
};
