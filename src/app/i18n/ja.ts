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
    /** サービス名。言語で変えないブランドなので、英語辞書でも同じ文字列を使う */
    name: "Koetrail",
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
    disclaimer:
      "各ストアとは関係のない非公式サービスです。掲載している情報の正確性・最新性は保証しません。詳しくは各ストアでご確認ください。",
    terms: "利用規約",
    privacy: "プライバシーポリシー",
    contact: "お問い合わせ",
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
    /** 規約・ポリシーの本文から `/contact` へ渡すリンクの文字列 */
    contactFormLink: "お問い合わせフォーム",
  },

  /** お問い合わせ画面 (`/contact`)。入力欄と送信の結果はすべてここ */
  contact: {
    title: "お問い合わせ",
    metaTitle: "お問い合わせ | {{app}}",
    metaDescription: "{{app}} への要望、不具合の報告、掲載内容の訂正・削除の申し出を受け付けます。",
    intro:
      "要望・不具合の報告・掲載内容の訂正の申し出・その他のご連絡を受け付けます。個別の返信はお約束できません。",
    kindLabel: "種別",
    kindRequest: "要望",
    kindBug: "不具合",
    kindCorrection: "掲載内容の訂正",
    kindOther: "その他",
    bodyLabel: "本文",
    bodyHint: "{{max}} 文字まで",
    /** 作品ページ・声優ページから訂正を申し出るリンクの文字列 (`components/correction-link.tsx`) */
    correctionLink: "掲載内容の誤りを知らせる",
    contactLabel: "連絡先 (任意)",
    contactHint: "返信が必要なときだけ、メールアドレスや SNS のアカウントを書いてください。",
    submit: "送信する",
    submitting: "送信中…",
    accepted: "送信しました。ありがとうございます。",
    /** 入力が通らないときの理由。上限は `@/domain/types` の値を埋め込む */
    errorBodyEmpty: "本文を入力してください。",
    errorBodyTooLong: "本文は {{max}} 文字以内で入力してください。",
    errorContactTooLong: "連絡先は {{max}} 文字以内で入力してください。",
    /** widget がまだ通っていない間に押されたとき */
    errorPending: "bot 対策の確認が終わるまで少しお待ちください。",
    /** サーバーが 403 を返したとき (検証を通らなかった) */
    errorRejected: "bot 対策の確認を通りませんでした。画面を読み込み直してからお試しください。",
    /** サーバーが 503 を返したとき (鍵が置かれていない) */
    errorUnavailable: "お問い合わせの受け付けが設定されていません。",
    errorFailed: "送信できませんでした。時間をおいてお試しください。",
    /** 送信できない環境。設定が無いので入力しても送れないことを先に言う */
    unavailable: "現在この画面からは送信できません。",
    unavailableAlternative: "次の窓口へご連絡ください。",
    /** 入力欄の近くに置く注記。保存されることを送信前に伝える */
    storageNote: "送信した内容はサーバーに保存されます。",
    privacyLink: "プライバシーポリシー",
  },

  common: {
    loading: "読み込み中…",
    /** 並べ替えの読み上げ名。今の値を畳み込む (`components/sort-select.tsx`) */
    sortLabel: "並び替え: {{name}}",
    /**
     * 絞り込みの欄に出す文言。絞り込みが横に並ぶ画面では、選ばれている値しか出ないと
     * どの軸の欄なのか押す前に分からないので、軸の名前と今の値の両方を出す
     */
    filterLabel: "{{axis}}: {{name}}",
    /** どの軸でも使う「絞っていない」選択肢 */
    filterAll: "すべて",
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
    heroTitle: "好きな声優の声が聴ける作品を見つける",
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

  /** フォロー一覧に置く、新作のブラウザ通知の区画 (`components/push-subscription-card.tsx`) */
  push: {
    title: "新作の通知",
    description: "フォロー中の声優の新作が出た週に、このブラウザへ 1 通だけ通知します。",
    enable: "新作の通知を受け取る",
    enabling: "設定しています…",
    /** 購読済みの状態。再読み込みしても同じ文が出る */
    enabled: "このブラウザで新作の通知を受け取る設定になっています。",
    disable: "通知を止める",
    disabling: "解除しています…",
    unsupported: "このブラウザは通知に対応していません。",
    /** iOS は Web Push をホーム画面に追加したサイトにしか届けない。手順そのものを書く */
    iosGuide:
      "iPhone / iPad では、Safari の共有メニューから「ホーム画面に追加」し、追加したアイコンから開いてから通知を設定してください。",
    denied:
      "通知がブラウザの設定でブロックされています。このサイトの通知を許可すると、ここから設定できます。",
    errorFailed: "通知の設定を保存できませんでした。しばらくしてからもう一度お試しください。",
    /** サーバーに何が渡るかは、購読する前に読める場所に書く */
    storageNote:
      "購読中は、フォロー中の声優と通知の宛先をサーバーに保存します。通知を止めると削除されます。",
    privacyLink: "プライバシーポリシー",
  },

  following: {
    metaTitle: "フォロー中の声優の新着 | {{app}}",
    title: "フォロー中",
    /** このブラウザにしか無いことは、消えたときに困る事実なので残す */
    storageNote: "このブラウザにのみ保存されます",
    /** 作品一覧の上に置く、フォロー中の声優と解除ボタンの見出し */
    manageTitle: "フォロー中の声優 {{count}} 人",
    listLabel: "フォロー中の声優",
    /**
     * 名前の隣に出す最新リリースの年月の読み上げ名。年月だけでは何の日付か分からないので、
     * 画面には出さずに読み上げにだけ入れる (`components/follow-manager.tsx`)
     */
    latestReleaseLabel: "最新リリース",
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
      "アニメに出演している声優の一覧です。名前を選ぶとその人の音声作品が見られます。まだ音声作品が無い声優もフォローできます。",
    title: "声優から探す",
    emptyTitle: "声優が見つかりません",
    sortName: "名前順",
    sortWorkCount: "作品数の多い順",
    /** ストアの絞り込み。選択肢のうちストア名 (`STORE_LABELS`) は辞書に持たない */
    storeFilterLabel: "ストアで絞り込む",
    /** 頭文字の絞り込み。選択肢の文字そのものは辞書に持たない。英語表示のときだけ出る */
    initialFilterLabel: "頭文字で絞り込む",
    /** ストアと頭文字のどちらでも使う「絞っていない」選択肢 */
    filterAll: "すべて",
    /** 性別の絞り込み。誰がどの性別かは画面に出さず、絞り込みの軸としてだけ使う */
    genderFilterLabel: "性別で絞り込む",
    genderAll: "全員",
    genderFemale: "女性",
    genderMale: "男性",
    /** 出どころ (AniList) が「女性でも男性でもない」と答えた声優が入る */
    genderOther: "その他",
    /** 出どころに性別が無い声優が入る。「その他」と分けないと、こちらの人数に埋もれる */
    genderUnknown: "不明",
    shownCount: "{{count}} 人",
    /** 上限で切っているとき。絞り込みに当てはまる人数と、いま並んでいる人数の両方を出す */
    shownOfTotal: "{{total}} 人中 {{count}} 人",
    /** 上限で切った残りを出すボタン。ストア・頭文字の「すべて」と違い、押すと元に戻せない */
    showAll: "すべて表示",
    /** 絞り込みの軸が 3 つあるので、どれで 0 人になったかは文にしない */
    filteredEmptyTitle: "この条件に当てはまる声優はいません",
  },

  actor: {
    title: "{{name}}の音声作品",
    /** 「{声優名} ASMR」「{声優名} Audible」のような検索で拾わせるため、区分とストア名を入れる */
    metaTitle: "{{name}}の音声作品 (ASMR・朗読・ボイスドラマ) | DLsite・Audible・ポケットドラマCD",
    metaDescription:
      "{{name}}が出演する ASMR・朗読・ボイスドラマを、DLsite・Audible・ポケットドラマCD から新着順にまとめています。",
    /** 作品が 1 件も無いとき。1 枚の案内だけを出し、実績も絞り込みも出さない */
    noWorksYetTitle: "音声作品はまだ見つかっていません",
    noWorksYetDescription:
      "フォローしておくと、この声優の音声作品が見つかったときに一覧に出てきます。",
    /** 見出しの下の実績。フォローを押す前に、何件出していて最後がいつかを見せる */
    latestRelease: "最新リリース {{date}}",
    /** ストアの絞り込みの軸の名前 (`common.filterLabel` に渡す) */
    storeFilterName: "ストア",
    /** 作品の区分 (ASMR・朗読など) の絞り込みの軸の名前 */
    categoryFilterName: "区分",
    /** 絞り込みで減ったとき。並べた件数と、そのうち残った件数を出す */
    shownOfListed: "{{total}} 作品中 {{count}} 作品",
    /**
     * 一覧を上限で切ったとき。切った先の作品は絞り込みにも当たらないので、
     * ストアを選んで 0 件になる理由がこれで読める
     */
    listLimited: "新しい順に {{count}} 作品まで載せています。",
    /** 絞り込みの軸が 3 つあるので、どれで 0 件になったかは文にしない */
    filteredEmptyTitle: "この条件に当てはまる作品はありません",
    /** 直近の取得がそのストアの全作品に届かなかったとき。網羅を約束しないことを画面で示す */
    partialCoverage: "{{store}} の作品は一部だけを載せています。",
    partialCoverageLink: "{{store}} で全作品を見る",
    animeTitle: "出演アニメ",
  },

  work: {
    metaCast: "{{names}} 出演。",
    metaDescription:
      "{{category}}の音声作品「{{title}}」の発売日・再生時間・出演者。{{stores}} で配信中。",
    makerName: "サークル / 出版社",
    releaseDate: "発売日",
    /**
     * 発売日を持たない作品に出す時点 (`lib/listed-at.ts`)。発売日と読み違えられないよう、
     * 日付の見出しにも新着の印と同じ「掲載」を置く
     */
    listedAt: "掲載確認",
    duration: "再生時間",
    castTitle: "出演",
    castEmpty: "出演者の情報はありません。",
    /** 新着のカードで、名前を出し切らなかったぶんの人数 */
    castMore: "他 {{count}} 名",
    purchaseTitle: "購入",
    checkAtStore: "価格と販売状況はストアでご確認ください。",
    /** Audible が Amazon のサービスだと分かるように書く。作品が無料で聴けるとは読めないようにする */
    audibleTrial: "Amazon のオーディオブックサービス Audible の無料体験に登録する",
    /** 新着の印。両言語とも短い方が並びが崩れないので英語のまま */
    badgeNew: "NEW",
    /** 発売日を持たない作品の新着の印。出たのではなく見つけたので、NEW と語を分ける */
    badgeListed: "掲載",
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
   * 作品の出演形態。クレジットの人数から決まる自前の区分なので翻訳する (`lib/appearance.ts`)。
   * 人数そのものは出さない。ストアのクレジットには漏れがあり、実数として読ませられない
   */
  appearance: {
    solo: "単独",
    small: "少人数",
    large: "大人数",
    /** クレジットが 1 件も取れていない作品。人数が分からないことをそのまま言う */
    unknown: "出演形態不明",
    /** 絞り込みの軸の名前 (`common.filterLabel` に渡す) */
    filterName: "出演形態",
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
    castTitle: "出演者",
    /** 「2026 年秋 ／ Frieren」。`{{alternate}}` は見出しに出していないほうのアニメ名 */
    subtitle: "{{season}} ／ {{alternate}}",
    /** 音声作品がまだ 1 件も無い出演者。行にはフォローだけが残る */
    noAudioWorksYet: "音声作品はまだありません",
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
    searchLabel: "アニメ名で検索",
    searchNoResults: "「{{query}}」に一致するアニメは見つかりませんでした。",
    /** 先頭に出している期の残りを見る導線。行き先はその期の一覧 */
    seeWholeSeason: "このシーズンをすべて見る",
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

    /** 管理画面どうしの行き来。どの画面から出しても同じ文言なので、行き先の名前で持つ */
    toHealth: "クローラー健全性へ",
    toUnmatched: "未解決クレジットへ",
    toInquiries: "問い合わせへ",

    healthMetaTitle: "クローラー健全性 | 管理",
    healthTitle: "クローラー健全性",
    healthSummary: "直近 24 時間: 成功 {{ok}} / 失敗 {{error}}。要対応 {{warnings}} 件。",
    healthEmpty: "まだクロールの記録がない。",
    healthColumnActor: "声優",
    /** 声優に紐付かない走行 (ストアの新着一覧) の行に出す */
    healthFeedRun: "新着一覧",
    healthColumnStore: "ストア",
    healthColumnLatestRun: "直近の実行",
    healthColumnWorkCount: "取得件数",
    healthColumnCoverage: "網羅",
    healthColumnDiff: "前回比",
    healthColumnNew: "新規",
    healthColumnStatus: "状態",
    healthCoverageIncomplete: "この走行では取り切れていない",
    healthStatusError: "失敗",
    healthStatusWarning: "要確認",
    healthStatusOk: "正常",

    unmatchedMetaTitle: "未解決クレジット | 管理",
    unmatchedTitle: "未解決クレジット",
    unmatchedSummary: "{{count}} 件の表記が声優に結び付いていない。",
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

    inquiriesMetaTitle: "問い合わせ | 管理",
    inquiriesTitle: "問い合わせ",
    inquiriesSummary: "新しい順。このページに {{count}} 件。",
    inquiriesEmpty: "まだ問い合わせは届いていない。",
    /** 続きを辿って行き過ぎたページ。1 件も届いていないのとは別の状態 */
    inquiriesEmptyPage: "このページに問い合わせは無い。前のページへ戻ること。",
    inquiriesColumnReceivedAt: "受け取った日時",
    inquiriesColumnKind: "種別",
    inquiriesColumnBody: "本文",
    inquiriesColumnContact: "連絡先",
    /** 連絡先は任意。空欄のままにせず、書かれなかったことが読めるようにする */
    inquiriesNoContact: "未記入",
    /** 送信者が選んだ種別。`INQUIRY_KINDS` と同じ綴りで引く */
    inquiryKind: {
      request: "要望",
      bug: "不具合",
      correction: "掲載内容の訂正",
      other: "その他",
    },
    inquiriesPagination: "問い合わせのページ送り",
    inquiriesPage: "{{page}} ページ目",
    inquiriesPrev: "前のページ",
    inquiriesNext: "次のページ",
  },
} as const;

export type Dictionary = typeof ja;
