/**
 * 日本語の辞書。キー構造の正はここで、`en.ts` は `Translations` 型でこの形を強制される。
 * キーを足す・消すときはこのファイルから触ること (en 側だけ直してもコンパイルが通らない)。
 *
 * - `{{name}}` は `t()` の埋め込み。ja に書いた変数名がそのまま型になるので、
 *   ここで綴りを間違えると呼び出し側がコンパイルエラーになる
 * - 作品名・声優名・サークル名・ストア名といったストア由来の値は辞書に入れない。
 *   翻訳せず、取得したまま画面に出す (設計の決定)
 * - `as const` を外さないこと。外すと値がただの string になり、埋め込み変数の型が取れなくなる
 * - 文は利用者に向けて書く。クローラー・収集・取得といった仕組みの語を出さない。
 *   仕組みの都合で見せられないものは「見つかりません」「ありません」と言う
 */
export const ja = {
  app: {
    /** サービス名。英語表記のブランドなので、英語辞書でも同じ文字列を使う */
    name: "Voice Actor Audio Release Radar",
    description:
      "好きな声優をフォローして、ASMR・朗読・ボイスドラマの新作を DLsite・Audible・ポケットドラマCD からまとめてチェック。",
  },

  nav: {
    home: "ホーム",
    voiceActors: "声優から探す",
    anime: "アニメから探す",
    following: "フォロー中",
  },

  footer: {
    unofficial:
      "各ストアとは関係のない非公式サービスです。作品情報は各ストアの公開ページをもとにしています。",
    price: "価格は取得時点のものです。最新の価格と販売状況は各ストアでご確認ください。",
    terms: "利用規約",
    privacy: "プライバシーポリシー",
  },

  /** 利用規約・プライバシーポリシー。本文は `src/app/legal/` にあり、ここは見出しと meta だけ */
  legal: {
    termsTitle: "利用規約",
    termsMetaTitle: "利用規約 | {{app}}",
    termsMetaDescription:
      "{{app}} の利用条件。掲載情報の出所と正確性、外部サイトへのリンク、免責、掲載内容の訂正・削除の申し出について定めます。",
    privacyTitle: "プライバシーポリシー",
    privacyMetaTitle: "プライバシーポリシー | {{app}}",
    privacyMetaDescription:
      "{{app}} が利用者のブラウザに保存する情報、サーバーに送られる情報、外部サービスへの通信について説明します。",
    effectiveDate: "制定日: {{date}}",
  },

  common: {
    loading: "読み込み中…",
    /** 並べ替えの読み上げ名。今の値を畳み込む (`components/sort-select.tsx`) */
    sortLabel: "並び替え: {{name}}",
    unknown: "不明",
    /** 「A・B」のような並びの区切り。英語では読点にする */
    listSeparator: "・",
    /** 「役名 ／ 主演 ／ 2026 年秋」のような、別種の項目を並べるときの区切り */
    slashSeparator: " ／ ",
    worksCount: "{{count}} 作品",
  },

  theme: {
    /**
     * 切り替えボタンの読み上げ用ラベル。今どちらかはアイコンに出ているので、
     * ラベルには押した先だけを言う (押すと反対の配色に固定される 2 択のトグル)
     */
    switchToLight: "ライトに切り替える",
    switchToDark: "ダークに切り替える",
    /** マウント前。まだどちらか確定していないので、動作だけを言う */
    labelPending: "配色を切り替える",
  },

  locale: {
    /**
     * 言語切り替えの読み上げ用ラベル。画面には言語名しか出ないので、
     * 何を選ぶ部品なのかをここで補う。今の言語も名前に含める
     */
    label: "表示言語: {{name}}",
    /** 言語名はその言語自身の表記で出す。英語辞書でも同じ文字列にする */
    ja: "日本語",
    en: "English",
  },

  notFound: {
    title: "ページが見つかりません",
    description: "URL が間違っているか、ページが移動した可能性があります。",
    toTop: "トップへ",
  },

  errorScreen: {
    title: "表示できませんでした",
    unknownCause: "予期しないエラーが発生しました。",
    retry: "再試行",
    toTop: "トップへ",
  },

  search: {
    label: "声優名で検索",
    searching: "検索中…",
    noResults: "「{{query}}」に一致する声優は見つかりませんでした。",
    resultsLabel: "検索結果",
  },

  follow: {
    follow: "フォロー",
    following: "フォロー中",
    unfollow: "フォロー解除",
    /** 解除ボタンが名前ごとに並ぶ場所の読み上げ用。見た目はアイコンだけ */
    unfollowActor: "{{name}}のフォローを解除",
  },

  home: {
    /** トップの h1 */
    heroTitle: "好きな声優の音声作品を、ストアをまたいで追う",
    latestTitle: "新着の音声作品",
    /** ストアのタブ。値はストア名 (`STORE_LABELS`) なので辞書には持たない */
    latestStoreTabsLabel: "ストアで絞り込む",
    latestStoreEmptyTitle: "{{store}} の新着はありません",
    /** フォローが 1 人以上のときだけ出す、フォロー中の作品一覧への導線 */
    latestToFollowing: "フォロー中の新着",
    browseTitle: "ほかの探し方",
    browseActorsTitle: "声優から探す",
    browseAnimeTitle: "アニメから探す",
  },

  following: {
    metaTitle: "フォロー中の声優の新着 | {{app}}",
    title: "フォロー中",
    /** このブラウザにしか無いことは、消えたときに困る事実なので残す */
    storageNote: "このブラウザにのみ保存されます",
    /** 作品一覧の上に置く、フォロー中の声優と解除ボタンの見出し */
    manageTitle: "フォロー中の声優 {{count}} 人",
    listLabel: "フォロー中の声優",
    emptyTitle: "まだ誰もフォローしていません",
    emptyAction: "声優を探す",
    errorTitle: "新着を読み込めませんでした",
    /** 次にすべきことなので残す */
    errorDescription: "しばらくしてから再読み込みしてください。",
    /** フォロー中の声優が出ているアニメ。作品 (音声) の一覧とは別の区画 */
    animeTitle: "フォロー中の声優が出ているアニメ",
    feedEmptyTitle: "この期間の新着はありません",
    feedEmptyAction: "声優を探す",
    tierUpcoming: "今後の発売",
    tierRecent: "{{days}} 日以内の新作",
    tierOlder: "それより前 ({{days}} 日以内)",
    /** 3 段目の開閉。畳んだ状態と開いた状態で読み上げを変える */
    tierExpand: "開く",
    tierCollapse: "畳む",
  },

  voiceActors: {
    metaTitle: "声優から探す | {{app}}",
    metaDescription:
      "ASMR・朗読・ボイスドラマなどの音声作品が見つかっている声優の一覧です。名前を選ぶとその人の作品が見られます。",
    title: "声優から探す",
    emptyTitle: "声優が見つかりません",
    sortName: "名前順",
    sortWorkCount: "作品数の多い順",
    /** ストアの絞り込み。選択肢のうちストア名 (`STORE_LABELS`) は辞書に持たない */
    storeFilterLabel: "ストアで絞り込む",
    storeFilterAll: "すべて",
    shownCount: "{{count}} 人",
    filteredEmptyTitle: "{{store}} に作品がある声優はいません",
  },

  actor: {
    title: "{{name}}の音声作品",
    /** 「{声優名} ASMR」「{声優名} Audible」のような検索で拾わせるため、区分とストア名を入れる */
    metaTitle: "{{name}}の音声作品 (ASMR・朗読・ボイスドラマ) | DLsite・Audible・ポケットドラマCD",
    metaDescription:
      "{{name}}が出演する ASMR・朗読・ボイスドラマを、DLsite・Audible・ポケットドラマCD から新着順にまとめています。",
    storeEmptyTitle: "{{store}} で見つかった作品はありません",
    animeTitle: "出演アニメ",
  },

  work: {
    metaCast: "{{names}} 出演。",
    metaDescription:
      "{{category}}の音声作品「{{title}}」の価格・発売日・再生時間。{{stores}} で配信中。",
    makerName: "サークル / 出版社",
    releaseDate: "発売日",
    duration: "再生時間",
    castTitle: "出演",
    castEmpty: "出演者の情報はありません。",
    /** 新着のカードで、名前を出し切らなかったぶんの人数 */
    castMore: "他 {{count}} 名",
    purchaseTitle: "購入",
    priceUnknown: "価格不明",
    unavailable: "現在は販売されていない可能性があります。",
    priceSeenAt: "{{at}} 時点の価格",
    /** 新着の印。両言語とも短い方が並びが崩れないので英語のまま */
    badgeNew: "NEW",
    badgeUpcoming: "発売予定 {{date}}",
    unread: "未読",
    noImage: "no image",
  },

  storeLink: {
    /** 買う場所に合わせて動詞を変える */
    dlsite: "DLsite で見る",
    audible: "Audible で聴く",
    pokedora: "ポケドラで聴く",
    missing: "リンクがありません。",
  },

  /**
   * 作品の区分。ストアの売り場名 (「ボイス・ASMR」など) ではなく、こちらで正規化した
   * 自前の区分なので翻訳する。ASMR は英語圏でもそのまま通じる語なので両言語同じ
   */
  category: {
    asmr: "ASMR",
    audio_drama: "ボイスドラマ",
    audiobook: "朗読",
    situation_voice: "シチュエーションボイス",
    other: "その他",
  },

  /**
   * 書式の中の語。日付と数値そのものは `Intl` に任せ、
   * 単位のように言語で並び方が変わるものだけを辞書で持つ (`lib/format.ts`)
   */
  format: {
    durationHoursMinutes: "{{hours}}時間{{minutes}}分",
    durationHours: "{{hours}}時間",
    durationMinutes: "{{minutes}}分",
  },

  season: {
    winter: "冬",
    spring: "春",
    summer: "夏",
    fall: "秋",
    /** 「2026 年秋」。英語では語順が逆になるのでキーごと差し替える */
    label: "{{year}} 年{{season}}",
  },

  anime: {
    metaTitle: "{{title}}の出演声優の音声作品",
    metaDescription:
      "{{title}}の出演声優のうち、ASMR・朗読・ボイスドラマなどの音声作品がある {{count}} 人とその作品。",
    castTitle: "音声作品がある出演者",
    /** 「2026 年秋 ／ Frieren」。`{{alternate}}` は見出しに出していないほうのアニメ名 */
    subtitle: "{{season}} ／ {{alternate}}",
    hasAudioWorks: "音声作品あり",
    workCount: "{{category}} {{count}}",
    roleMain: "主演",
    roleSupporting: "助演",
    actorCount: "音声作品がある出演者 {{count}} 人",
    seasonMetaTitle: "{{season}}アニメの出演声優の音声作品",
    seasonMetaDescription:
      "{{season}}のアニメに出演している声優のうち、ASMR・朗読・ボイスドラマなどの音声作品がある人をまとめています。",
    seasonTitle: "{{season}}アニメ",
    sortPopularity: "人気順",
    sortActorCount: "音声作品がある出演者の多い順",
    seasonEmptyTitle: "{{season}}のアニメはありません",
    /** /anime はシーズンの索引。並べるシーズンが 1 つも無いときだけこれが出る */
    indexEmptyTitle: "アニメがありません",
    indexTitle: "アニメから探す",
    indexDescription: "シーズンを選ぶと、その期のアニメが並びます。",
    indexMetaTitle: "アニメから声優の音声作品を探す | {{app}}",
    indexMetaDescription:
      "シーズンごとのアニメから、出演声優の ASMR・朗読・ボイスドラマをたどれます。",
    seasonListLabel: "シーズン",
    /** シーズンに入っているアニメの本数。音声作品の数 (common.worksCount) とは別物 */
    titleCount: "{{count}} 作品",
    olderSeason: "前のシーズン ({{season}})",
    newerSeason: "次のシーズン ({{season}})",
    allSeasons: "すべてのシーズン",
    followedFilterLabel: "フォロー中の声優が出ている作品だけ",
    followedMark: "フォロー中の声優が出演",
    followedEmptyTitle: "フォロー中の声優が出ている作品はありません",
  },

  /** 管理画面。読むのは運用者なので、仕組みの語 (クローラー・クロール) をそのまま使う */
  admin: {
    unauthorizedTitle: "管理者トークンが必要です",
    unauthorizedConfigured:
      "このページの URL に ?token=<ADMIN_TOKEN> を付けて開き直すこと。トークンは HttpOnly cookie に保存され、URL からは取り除かれる。",
    unauthorizedMissing:
      "サーバーに ADMIN_TOKEN が設定されていない。`wrangler secret put ADMIN_TOKEN` (ローカルは .dev.vars) で設定すること。",

    healthMetaTitle: "クローラー健全性 | 管理",
    healthTitle: "クローラー健全性",
    healthSummary: "直近 24 時間: 成功 {{ok}} / 失敗 {{error}}。要対応 {{warnings}} 件。",
    healthToUnmatched: "未解決クレジットへ",
    healthEmpty: "まだクロールの記録がない。",
    healthColumnActor: "声優",
    healthColumnStore: "ストア",
    healthColumnLatestRun: "直近の実行",
    healthColumnWorkCount: "取得件数",
    healthColumnCoverage: "網羅",
    healthColumnDiff: "前回比",
    healthColumnNew: "新規",
    healthColumnStatus: "状態",
    healthCoverageIncomplete: "検索の 1 ページ目では取り切れていない",
    healthStatusError: "失敗",
    healthStatusWarning: "要確認",
    healthStatusOk: "正常",

    unmatchedMetaTitle: "未解決クレジット | 管理",
    unmatchedTitle: "未解決クレジット",
    unmatchedSummary: "{{count}} 件の表記が声優に結び付いていない。",
    unmatchedToHealth: "クローラー健全性へ",
    unmatchedEmpty: "未解決の表記はない。",
    unmatchedCount: "{{count}} 件",
    unmatchedCandidate: "候補:",
    unmatchedNoCandidate: "候補なし。一覧から選ぶこと。",
    unmatchedFilterLabel: "声優を絞り込む",
    unmatchedFilterPlaceholder: "名前 / かな",
    unmatchedSelectLabel: "割り当てる声優",
    unmatchedSelectPlaceholder: "選択してください",
    unmatchedAddAlias: "この表記をエイリアスとして登録する",
    unmatchedSaving: "割り当て中…",
    unmatchedSubmit: "{{count}} 件を割り当てる",
    unmatchedError: "割り当てに失敗した",
  },
} as const;

export type Dictionary = typeof ja;
