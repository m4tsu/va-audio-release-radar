import { type LocalizedLegalDocument, OPERATOR_NAME } from "./index";

/**
 * プライバシーポリシー。条の id と並びは両言語で同じにする (`legal.test.ts`)。
 *
 * 「何をどこに保存し、何をどこへ送るか」は実装に合わせてある。変えたらここも直すこと:
 * - ブラウザ内の保存: `src/app/store/follow-store.ts` (IndexedDB)、`src/app/server-fns/locale.ts` (cookie)、
 *   `src/app/hooks/use-theme.ts` (localStorage)
 * - サーバーへ送るもの: `src/app/server-fns/works.ts` の `fetchFeed` (フォロー中の声優 ID)、
 *   `src/app/server-fns/inquiries.ts` の `submitInquiryFn` (お問い合わせの内容。`inquiries` 表に保存する)、
 *   `src/app/store/push-store.ts` (通知の購読。宛先・鍵・言語・フォロー中の声優 ID を `push_subscriptions` に保存する)
 * - 操作の計測: `src/app/lib/usage-events.ts` (操作の種類とストアの別、フォローを押した場所を `/api/event` へ送る。
 *   `src/server/usage-events.ts` が Workers Analytics Engine に書く) と、同じファイルの Cloudflare Web Analytics の読み込み
 * - 通知を購読したブラウザが通信する外部のもの: ブラウザの提供元の push service (`public/sw.js` が受ける)
 * - お問い合わせ画面が読み込む外部のもの: `src/app/hooks/use-turnstile.ts` (Cloudflare Turnstile)
 * - 外部サーバーから読むもの: `src/app/components/work-card.tsx` の表紙画像、
 *   ストアへのリンクに含まれるアフィリエイトの成果計測の画像 (アフィリエイトサービスプロバイダが配る広告コードの一部)
 * - アクセスログ: `wrangler.jsonc` の `observability`
 */
export const privacy: LocalizedLegalDocument = {
  ja: {
    effectiveDate: "2026-09-26",
    sections: [
      {
        id: "overview",
        heading: "1. 基本方針",
        blocks: [
          {
            type: "paragraph",
            text: `Koetrail (以下「本サービス」) を提供する ${OPERATOR_NAME.ja} (以下「運営者」) は、本サービスの利用者の情報を次のとおり扱います。`,
          },
          {
            type: "paragraph",
            text: "本サービスにはアカウントの登録がありません。氏名やパスワードを入力する機能は無く、運営者はそれらを取得しません。メールアドレスなどの連絡先も、利用者がお問い合わせの連絡先欄に自ら記入した場合を除いて取得しません。",
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
              "新作のブラウザ通知を有効にすると、通知の宛先 (ブラウザが発行する URL と暗号鍵)、表示言語、フォローしている声優の ID がサーバーに送られ、通知を送るために保存されます。フォローを変えるたびに送り直され、サーバー側も同じ内容に更新されます。宛先はブラウザごとに異なり、利用者を特定するためには使いません。通知を止めるとサーバーから削除されます。ブラウザ側で通知を取り消した場合も、次に通知を送ろうとした時点で削除されます。",
              "表示言語の Cookie は、ページを取得するたびにサーバーへ送られ、その言語でページを作るために使われます。",
              "フォローを押したときと、作品ページで販売サイトへのリンク (Audible の無料体験への登録を含む) を押したとき、その操作の種類と、フォローを押した画面の別 (声優ページ・声優一覧など)、リンク先の販売サイトの別がサーバーに送られ、回数を集計するために Cloudflare, Inc. の Workers Analytics Engine に保存されます。この記録には、フォローした声優、作品、IP アドレスなど、操作した人や操作の対象を特定しうる情報を含めません。フォローを外したときは送られません。",
              "お問い合わせを送信すると、選んだ種別、本文、記入した場合の連絡先がサーバーに送られ、運営者が読めるように保存されます。運営者はこれを、内容の確認と本サービスの改善、必要な場合の返信のためにのみ使います。フォローしている声優は添えられません。",
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
              "アフィリエイトの成果を計測するため、作品ページは、アフィリエイトサービスプロバイダ (バリューコマース株式会社) のサーバーから 1 ピクセルの画像を読み込みます。そのため、作品ページを表示すると利用者のブラウザから同社のサーバーへ通信が発生し、IP アドレスや参照元のページなどが同社に送られます。この画像は画面には表示されません。同社における取り扱いは同社のプライバシーポリシーに従います。",
              "お問い合わせ画面は、自動化された送信を防ぐために Cloudflare, Inc. の bot 対策 (Cloudflare Turnstile) を利用者のブラウザに読み込みます。この画面を開くと利用者のブラウザから Cloudflare のサーバーへ通信が発生し、IP アドレスなどが Cloudflare に送られます。Cloudflare における取り扱いは Cloudflare のプライバシーポリシーに従います。この読み込みはお問い合わせ画面でのみ行われます。",
              "ページの閲覧数を集計するため、本サービスは Cloudflare, Inc. のアクセス解析 (Cloudflare Web Analytics) の計測用スクリプトを利用者のブラウザに読み込みます。ページを表示すると利用者のブラウザから Cloudflare のサーバーへ通信が発生し、表示したページの URL (クエリ文字列を除く)、参照元のページ、ブラウザの種類、ページの読み込みにかかった時間、IP アドレスなどが Cloudflare に送られます。この計測は Cookie やブラウザのローカルストレージを使用せず、フォローしている声優は送られません。Cloudflare における取り扱いは Cloudflare のプライバシーポリシーに従います。",
              "新作のブラウザ通知は、利用者のブラウザの提供元 (Google、Apple、Mozilla など) が運営する通知配信サーバーを経由して届きます。通知を有効にすると、利用者のブラウザがその配信サーバーと通信します。通知の本文は暗号化されており、配信サーバーは内容を読めません。各提供元における取り扱いは、それぞれのプライバシーポリシーに従います。",
              "上記のアフィリエイトの成果計測とアクセス解析を除き、本サービスは広告配信のためのタグや SNS の埋め込みを使用していません。",
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
            text: "本ポリシーに関するお問い合わせは、本サービスの次の画面で受け付けます。",
            withExternal: "次の窓口でも受け付けます。",
          },
        ],
      },
    ],
  },

  en: {
    effectiveDate: "2026-09-26",
    sections: [
      {
        id: "overview",
        heading: "1. Overview",
        blocks: [
          {
            type: "paragraph",
            text: `${OPERATOR_NAME.en} (the "Operator"), which provides Koetrail (the "Service"), handles information about Users of the Service as described below.`,
          },
          {
            type: "paragraph",
            text: "The Service has no user accounts. There is no feature for entering a name or a password, and the Operator does not collect such information. Nor does the Operator collect an email address or other contact detail, unless you choose to enter one in the contact form.",
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
              "If you turn on browser notifications for new releases, the delivery address (a URL and encryption keys issued by your browser), your language and the IDs of the voice actors you follow are sent to the server and stored in order to send you notifications. They are sent again whenever you change who you follow, and the server is updated to match. The address differs for each browser and is not used to identify you. Stopping notifications deletes them from the server. If you revoke the notification in your browser instead, they are deleted the next time a notification is attempted.",
              "The language cookie is sent to the server with each page request and used to render the page in that language.",
              "When you press Follow, or a link to a store on a work page (including the link to sign up for the Audible free trial), the kind of action, which screen you pressed Follow on (such as a voice actor's page or the voice actor list) and which store the link leads to are sent to the server and stored in Workers Analytics Engine, operated by Cloudflare, Inc., to count how often each happens. This record does not include the voice actor you followed, the work, your IP address or anything else that could identify you or what you acted on. Nothing is sent when you unfollow.",
              "When you send a message from the contact page, the type you chose, the message and any contact detail you entered are sent to the server and stored so that the Operator can read them. The Operator uses them only to review what you sent, to improve the Service and to reply where needed. The voice actors you follow are not attached.",
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
              "To measure affiliate referrals, work pages load a one-pixel image from the servers of the affiliate service provider (ValueCommerce Co., Ltd.). Displaying a work page therefore causes your browser to connect to those servers, which receive your IP address, the referring page and similar details. The image is not visible on screen. ValueCommerce's handling of this data is governed by its own privacy policy.",
              "The contact page loads Cloudflare Turnstile, a bot protection service operated by Cloudflare, Inc., to prevent automated submissions. Opening that page therefore causes your browser to connect to Cloudflare's servers, which receive your IP address and similar details. Cloudflare's handling of this data is governed by Cloudflare's privacy policy. No other page loads it.",
              "To count page views, the Service loads the measurement script of Cloudflare Web Analytics, an analytics service operated by Cloudflare, Inc., in your browser. Displaying a page therefore causes your browser to connect to Cloudflare's servers, which receive the URL of the page (without the query string), the referring page, your browser type, how long the page took to load, your IP address and similar details. This measurement does not use cookies or your browser's local storage, and the voice actors you follow are not sent. Cloudflare's handling of this data is governed by Cloudflare's privacy policy.",
              "Browser notifications for new releases are delivered through the push service run by your browser's vendor (such as Google, Apple or Mozilla). When you turn notifications on, your browser connects to that service. The content of each notification is encrypted and cannot be read by the push service. Each vendor's handling of this data is governed by its own privacy policy.",
              "Apart from the affiliate measurement and the analytics described above, the Service does not use advertising tags or social media embeds.",
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
            text: "Questions about this policy can be sent from the following page on the Service.",
            withExternal: "They are also accepted at the following contact point.",
          },
        ],
      },
    ],
  },
};
