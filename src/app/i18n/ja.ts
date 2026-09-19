/**
 * 日本語の辞書。キー構造の正はここで、`en.ts` は `Translations` 型でこの形を強制される。
 * キーを足す・消すときはこのファイルから触ること (en 側だけ直してもコンパイルが通らない)。
 *
 * - `{{name}}` は `t()` の埋め込み。ja に書いた変数名がそのまま型になるので、
 *   ここで綴りを間違えると呼び出し側がコンパイルエラーになる
 * - 作品名・声優名・サークル名・ストア名といったストア由来の値は辞書に入れない。
 *   翻訳せず、取得したまま画面に出す (設計の決定)
 * - `as const` を外さないこと。外すと値がただの string になり、埋め込み変数の型が取れなくなる
 */
export const ja = {
  app: {
    /** サービス名。英語表記のブランドなので、英語辞書でも同じ文字列を使う */
    name: "Voice Actor Audio Release Radar",
    description:
      "好きな声優をフォローすると、複数の音声販売サービスを横断して新しく買える音声作品だけを一か所で追える Web サービス。",
  },

  nav: {
    home: "ホーム",
    following: "フォロー中",
  },

  footer: {
    unofficial: "非公式サービス。作品情報は各ストアの公開情報に基づく。",
    price: "価格は取得時点のもの。最新の価格と販売状況は各ストアで確認すること。",
  },

  common: {
    loading: "読み込み中…",
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
    description: "URL が変わったか、その声優・作品をまだ収集していない可能性がある。",
    toTop: "トップへ",
  },

  errorScreen: {
    title: "表示できませんでした",
    unknownCause: "原因を特定できませんでした。",
    retry: "再試行",
    toTop: "トップへ",
  },

  search: {
    label: "声優を探してフォローする",
    placeholder: "声優名 (例: 上田麗奈)",
    searching: "検索中…",
    noResults: "「{{query}}」に一致する声優は見つかりませんでした。",
    resultsLabel: "検索結果",
  },

  follow: {
    follow: "フォロー",
    following: "フォロー中",
    unfollow: "フォロー解除",
  },

  home: {
    followPrompt:
      "好きな声優をフォローすると、ここが DLsite と Audible を横断した「フォロー中の新着」に変わる。アカウント登録は不要で、フォローはこのブラウザにだけ保存される。",
    latestTitle: "最近の新着 (全声優)",
    latestEmptyTitle: "まだ新着がありません",
    latestEmptyDescription: "クローラーが作品を集めるとここに並ぶ。",
    actorDirectoryTitle: "声優一覧",
    feedTitle: "フォロー中の新着",
    feedSummary: "フォロー中 {{count}} 人の、発売日が直近 {{days}} 日 / 発売予定の音声作品。",
    feedErrorTitle: "新着を取得できませんでした",
    feedErrorDescription: "時間をおいて再読み込みすること。",
    feedEmptyTitle: "この期間の新着はありません",
    feedEmptyDescription: "フォローを増やすか、時間をおいて見ること。",
    feedEmptyAction: "フォロー中の声優を見る",
    tierUpcoming: "今後の発売",
    tierRecent: "{{days}} 日以内の新作",
    tierOlder: "それ以前 (直近 {{days}} 日)",
    /** 3 段目の開閉。畳んだ状態と開いた状態で読み上げを変える */
    tierExpand: "開く",
    tierCollapse: "畳む",
    /** `{{season}}` には「2026 年秋」のようなシーズン名が入る */
    seasonTitle: "{{season}}アニメから探す",
    seasonSeeAll: "すべて見る ({{count}})",
  },

  following: {
    metaTitle: "フォロー中の声優 | {{app}}",
    title: "フォロー中",
    description: "フォローはこのブラウザにだけ保存される。別の端末には引き継がれない。",
    emptyTitle: "まだ誰もフォローしていません",
    emptyDescription: "トップの検索から声優を探してフォローすると、ここと新着フィードに並ぶ。",
    emptyAction: "声優を探す",
    listLabel: "フォロー中の声優",
  },

  actor: {
    title: "{{name}}の新着音声作品",
    metaTitle: "{{name}}の新着音声作品 | DLsite・Audible",
    metaDescription: "{{name}}が出演する DLsite の ASMR・ボイス作品と Audible の朗読を新着順に。",
    subtitle: "DLsite・Audible を横断した新着順",
    subtitleWithKana: "{{kana}} ／ DLsite・Audible を横断した新着順",
    storeEmptyTitle: "まだ見つかっていません",
    storeEmptyDescription: "{{store}} でのこの声優の作品は、まだ収集できていない。",
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
    castEmpty: "クレジット情報を取得できていない。",
    purchaseTitle: "購入",
    priceUnknown: "価格不明",
    unavailable: "現在は販売されていない可能性がある。",
    priceSeenAt: "価格の取得時点: {{at}}",
    /** 新着の印。両言語とも短い方が並びが崩れないので英語のまま */
    badgeNew: "NEW",
    badgeUpcoming: "発売予定 {{date}}",
    unread: "未読",
    noImage: "no image",
  },

  storeLink: {
    /** 買う場所に合わせて動詞を変える (企画書 §15) */
    dlsite: "DLsite で見る",
    audible: "Audible で聴く",
    pokedora: "ポケドラで聴く",
    missing: "このストアへのリンクを取得できていない。",
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
    metaTitle: "{{title}}のキャストが出ている音声作品",
    metaDescription:
      "{{title}}に出演している声優のうち、ASMR・朗読・ドラマ CD を出している {{count}} 人と、その作品数。",
    castTitle: "この作品の出演者で、音声作品を出している人",
    /** 「2026 年秋 ／ Frieren」。`{{english}}` は AniList 由来なので訳さない */
    subtitle: "{{season}} ／ {{english}}",
    hasAudioWorks: "音声作品あり",
    workCount: "{{category}} {{count}}",
    roleMain: "主演",
    roleSupporting: "助演",
    actorCount: "出演者 {{count}} 人に音声作品",
    seasonMetaTitle: "{{season}}アニメのキャストが出ている音声作品",
    seasonMetaDescription:
      "{{season}}のアニメに出演している声優のうち、ASMR・朗読・ドラマ CD を出している人をまとめて。",
    seasonTitle: "{{season}}アニメ",
    seasonDescription: "出演者が音声作品を出している作品だけを並べている。",
    seasonEmptyTitle: "まだ見つかっていません",
    seasonEmptyDescription:
      "{{season}}のアニメで、音声作品を出している出演者はまだ収集できていない。",
  },

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
