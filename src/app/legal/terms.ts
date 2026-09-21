import type { LocalizedLegalDocument } from "./index";

/**
 * 利用規約。条の id と並びは両言語で同じにする (`legal.test.ts`)。
 * サービスの仕組みに触れる条 (掲載情報の出所、外部リンク、成人向け作品の扱い) は
 * `docs/product.md` と `src/app/components/store-link.tsx` の実装に合わせてある
 */
export const terms: LocalizedLegalDocument = {
  ja: {
    effectiveDate: "2026-09-21",
    sections: [
      {
        id: "scope",
        heading: "第1条 (本規約の適用)",
        blocks: [
          {
            type: "paragraph",
            text: "この利用規約 (以下「本規約」) は、Koenect (以下「本サービス」) の利用条件を定めるものです。本サービスを利用する方 (以下「利用者」) は、本規約に同意したうえで本サービスを利用するものとします。",
          },
          {
            type: "paragraph",
            text: "本サービスは、本サービスの運営者 (以下「運営者」) が個人として提供します。",
          },
        ],
      },
      {
        id: "service",
        heading: "第2条 (本サービスの内容)",
        blocks: [
          {
            type: "paragraph",
            text: "本サービスは、アニメに出演している声優の音声作品 (ASMR、朗読、ボイスドラマなど) について、複数の販売サイトに公開されている情報をまとめて表示し、利用者がフォローした声優の新作を確認できるようにするものです。",
          },
          {
            type: "list",
            items: [
              "本サービスは作品の販売を行いません。作品の購入や視聴は、各販売サイトにおいて、その販売サイトの規約に従って行われます。",
              "本サービスは、各販売サイトおよびアニメ情報の提供元とは関係のない非公式のサービスです。",
              "本サービスでは成人向けに区分された作品を掲載しません。",
              "本サービスの利用にアカウントの登録は不要です。フォローした声優などの情報は利用者のブラウザにのみ保存されます。詳細はプライバシーポリシーに定めます。",
            ],
          },
        ],
      },
      {
        id: "accuracy",
        heading: "第3条 (掲載情報の正確性)",
        blocks: [
          {
            type: "paragraph",
            text: "本サービスに掲載する作品名、出演者、発売日、再生時間などの情報は、各販売サイトが公開しているページをもとに機械的に取得したものです。運営者はその正確性、完全性、最新性を保証しません。",
          },
          {
            type: "list",
            items: [
              "本サービスは価格と販売状況を掲載していません。各販売サイトで確認してください。",
              "出演者の表記は販売サイト上の表記をもとに声優に対応付けています。表記の揺れや同名の別人により、対応付けが誤っている場合があります。",
              "購入や視聴の前に、必ず各販売サイトで最新の情報を確認してください。",
            ],
          },
        ],
      },
      {
        id: "stores",
        heading: "第4条 (外部サイトへのリンクとアフィリエイト)",
        blocks: [
          {
            type: "paragraph",
            text: "本サービスは各販売サイトの作品ページへのリンクを掲載します。リンク先のサイトは運営者が管理するものではなく、その内容や取引について運営者は責任を負いません。",
          },
          {
            type: "paragraph",
            text: "本サービスは、販売サイトが提供するアフィリエイトプログラムに参加することがあります。その場合、本サービスのリンクを経由して作品が購入されると、運営者が販売サイトから報酬を受け取ることがあります。これによって利用者の支払う金額が変わることはありません。",
          },
        ],
      },
      {
        id: "ip",
        heading: "第5条 (知的財産権)",
        blocks: [
          {
            type: "paragraph",
            text: "本サービスに掲載する作品名、作品の画像、サークル名や出版社名、声優名その他の情報に関する権利は、それぞれの権利者に帰属します。本サービスはこれらを、作品を紹介し販売サイトへ案内する目的の範囲で掲載します。",
          },
          {
            type: "paragraph",
            text: "本サービス自体の文章、デザイン、プログラムに関する権利は運営者に帰属します。",
          },
        ],
      },
      {
        id: "prohibited",
        heading: "第6条 (禁止事項)",
        blocks: [
          {
            type: "paragraph",
            text: "利用者は、本サービスの利用にあたり、次の行為をしてはなりません。",
          },
          {
            type: "list",
            items: [
              "本サービスのサーバーに過度な負荷をかける行為",
              "運営者向けの管理機能に権限なくアクセスしようとする行為",
              "本サービスの運営を妨害する行為",
              "法令または公序良俗に反する行為",
              "その他、運営者が不適切と合理的に判断する行為",
            ],
          },
          {
            type: "paragraph",
            text: "運営者は、これらの行為が認められた場合、事前の通知なく該当する通信を遮断するなどの措置をとることがあります。",
          },
        ],
      },
      {
        id: "disclaimer",
        heading: "第7条 (免責)",
        blocks: [
          {
            type: "paragraph",
            text: "運営者は、本サービスが利用者の特定の目的に適合すること、期待する機能や正確性を有すること、中断や誤りが無いことを保証しません。",
          },
          {
            type: "paragraph",
            text: "運営者は、本サービスの利用または利用できなかったことにより利用者に生じた損害について、運営者の故意または重大な過失による場合を除き、責任を負いません。運営者が責任を負う場合でも、その範囲は通常生じうる直接の損害に限ります。ただし、この条項は消費者契約法その他の強行法規により制限される範囲では適用されません。",
          },
        ],
      },
      {
        id: "takedown",
        heading: "第8条 (掲載内容に関する申し出)",
        blocks: [
          {
            type: "paragraph",
            text: "作品の権利者、声優本人、その所属事務所など、掲載内容に関係する方は、掲載内容の訂正または削除を運営者に申し出ることができます。運営者は申し出の内容を確認し、合理的な期間内に対応します。",
          },
          {
            type: "paragraph",
            text: "申し出には、該当するページの URL、訂正または削除を求める箇所、申し出る方と掲載内容との関係を記載してください。",
          },
        ],
      },
      {
        id: "changes",
        heading: "第9条 (本サービスの変更、停止、終了)",
        blocks: [
          {
            type: "paragraph",
            text: "運営者は、利用者への事前の通知なく、本サービスの内容を変更し、一時的に停止し、または終了することがあります。これにより利用者に生じた損害について、運営者は第7条の定めに従うほかは責任を負いません。",
          },
        ],
      },
      {
        id: "amendment",
        heading: "第10条 (本規約の変更)",
        blocks: [
          {
            type: "paragraph",
            text: "運営者は、必要に応じて本規約を変更することがあります。変更後の本規約は、本サービス上に掲載した時点から効力を生じます。利用者に不利益となる重要な変更を行う場合は、本サービス上で相当な期間前に周知します。",
          },
        ],
      },
      {
        id: "law",
        heading: "第11条 (準拠法と裁判管轄)",
        blocks: [
          {
            type: "paragraph",
            text: "本規約は日本法に準拠します。本サービスに関して運営者と利用者との間で紛争が生じた場合、運営者の住所地を管轄する地方裁判所を第一審の専属的合意管轄裁判所とします。",
          },
        ],
      },
      {
        id: "contact",
        heading: "第12条 (お問い合わせ)",
        blocks: [
          {
            type: "contact",
            text: "本規約および本サービスに関するお問い合わせ、掲載内容の訂正・削除の申し出は、本サービスの次の画面で受け付けます。",
            withExternal: "次の窓口でも受け付けます。",
          },
        ],
      },
    ],
  },

  en: {
    effectiveDate: "2026-09-21",
    sections: [
      {
        id: "scope",
        heading: "1. Scope",
        blocks: [
          {
            type: "paragraph",
            text: 'These Terms of Service (the "Terms") set out the conditions for using Koenect (the "Service"). By using the Service, you (the "User") agree to be bound by these Terms.',
          },
          {
            type: "paragraph",
            text: 'The Service is provided by its operator (the "Operator") as an individual.',
          },
        ],
      },
      {
        id: "service",
        heading: "2. What the Service does",
        blocks: [
          {
            type: "paragraph",
            text: "The Service collects publicly available information about audio works (ASMR, audiobooks, audio dramas and similar) featuring anime voice actors from several online stores, presents it in one place, and lets Users follow voice actors to keep track of their new releases.",
          },
          {
            type: "list",
            items: [
              "The Service does not sell any works. Purchases and playback take place on each store, under that store's own terms.",
              "The Service is unofficial and has no affiliation with any store or with the source of anime information.",
              "The Service does not list works classified as adult-only.",
              "No account is needed. Information such as the voice actors you follow is stored only in your browser. See the Privacy Policy for details.",
            ],
          },
        ],
      },
      {
        id: "accuracy",
        heading: "3. Accuracy of information",
        blocks: [
          {
            type: "paragraph",
            text: "Titles, cast, release dates, durations and other information shown on the Service are collected automatically from pages that each store makes public. The Operator does not guarantee that this information is accurate, complete or up to date.",
          },
          {
            type: "list",
            items: [
              "The Service does not list prices or availability. Please check them on each store.",
              "Cast credits are matched to voice actors based on how names appear on the store. Variations in spelling or people sharing a name can lead to incorrect matches.",
              "Always check the latest information on the store before purchasing or listening.",
            ],
          },
        ],
      },
      {
        id: "stores",
        heading: "4. Links to stores and affiliate programs",
        blocks: [
          {
            type: "paragraph",
            text: "The Service links to product pages on each store. Those sites are not controlled by the Operator, and the Operator is not responsible for their content or for any transaction made there.",
          },
          {
            type: "paragraph",
            text: "The Service may take part in affiliate programs offered by the stores. In that case, the Operator may receive a commission from the store when a work is purchased through a link on the Service. This does not change the price you pay.",
          },
        ],
      },
      {
        id: "ip",
        heading: "5. Intellectual property",
        blocks: [
          {
            type: "paragraph",
            text: "Rights in the titles, cover images, circle and publisher names, voice actor names and other information shown on the Service belong to their respective owners. The Service displays them only to introduce the works and direct Users to the stores.",
          },
          {
            type: "paragraph",
            text: "Rights in the Service's own text, design and software belong to the Operator.",
          },
        ],
      },
      {
        id: "prohibited",
        heading: "6. Prohibited conduct",
        blocks: [
          {
            type: "paragraph",
            text: "When using the Service, Users must not:",
          },
          {
            type: "list",
            items: [
              "place an excessive load on the Service's servers;",
              "attempt to access the Operator's administrative features without authorization;",
              "interfere with the operation of the Service;",
              "violate any law or public order;",
              "engage in any other conduct the Operator reasonably deems inappropriate.",
            ],
          },
          {
            type: "paragraph",
            text: "If such conduct is found, the Operator may take measures such as blocking the traffic involved without prior notice.",
          },
        ],
      },
      {
        id: "disclaimer",
        heading: "7. Disclaimer",
        blocks: [
          {
            type: "paragraph",
            text: "The Operator does not warrant that the Service will fit any particular purpose, provide any expected function or accuracy, or operate without interruption or error.",
          },
          {
            type: "paragraph",
            text: "The Operator is not liable for any damage arising from use of, or inability to use, the Service, except where caused by the Operator's willful misconduct or gross negligence. Where the Operator is liable, liability is limited to direct damage that would ordinarily arise. This clause does not apply to the extent it is restricted by the Consumer Contract Act of Japan or other mandatory law.",
          },
        ],
      },
      {
        id: "takedown",
        heading: "8. Requests about listed content",
        blocks: [
          {
            type: "paragraph",
            text: "Rights holders of a work, the voice actor concerned, their agency and other parties related to listed content may ask the Operator to correct or remove that content. The Operator will review the request and respond within a reasonable period.",
          },
          {
            type: "paragraph",
            text: "Please include the URL of the page in question, the part you want corrected or removed, and your relationship to the content.",
          },
        ],
      },
      {
        id: "changes",
        heading: "9. Changes to, suspension and termination of the Service",
        blocks: [
          {
            type: "paragraph",
            text: "The Operator may change, temporarily suspend or terminate the Service without prior notice to Users. The Operator's liability for any resulting damage is governed by Section 7.",
          },
        ],
      },
      {
        id: "amendment",
        heading: "10. Changes to these Terms",
        blocks: [
          {
            type: "paragraph",
            text: "The Operator may amend these Terms when necessary. Amended Terms take effect when posted on the Service. For material changes that are unfavorable to Users, the Operator will give notice on the Service a reasonable period in advance.",
          },
        ],
      },
      {
        id: "law",
        heading: "11. Governing law and jurisdiction",
        blocks: [
          {
            type: "paragraph",
            text: "These Terms are governed by the laws of Japan. Any dispute between the Operator and a User concerning the Service is subject to the exclusive jurisdiction of the district court having jurisdiction over the Operator's place of residence as the court of first instance.",
          },
        ],
      },
      {
        id: "contact",
        heading: "12. Contact",
        blocks: [
          {
            type: "contact",
            text: "Questions about these Terms or the Service, and requests to correct or remove listed content, can be sent from the following page on the Service.",
            withExternal: "They are also accepted at the following contact point.",
          },
        ],
      },
    ],
  },
};
