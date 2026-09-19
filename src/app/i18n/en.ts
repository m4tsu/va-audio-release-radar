import type { Translations } from "./index";

/**
 * 英語の辞書。キー構造は `ja.ts` が正で、この `Translations` 型が同じ形を強制する。
 * ja にキーを足してここを直し忘れるとコンパイルが落ちる (それが狙い)。
 *
 * - 数で語形が変わる文言は `{ one, other }` で書く。`t()` に `count` を渡すと選ばれる
 * - 作品名・声優名・サークル名は辞書に入っていない。翻訳せずそのまま出す
 */
export const en: Translations = {
  app: {
    // ブランド名なので訳さない
    name: "Voice Actor Audio Release Radar",
    description:
      "Follow the voice actors you like and track their new audio works across multiple stores in one place.",
  },

  nav: {
    home: "Home",
    following: "Following",
  },

  footer: {
    unofficial: "Unofficial service. Work information comes from each store's public pages.",
    price: "Prices are from the time they were collected. Check each store for the current price.",
  },

  common: {
    loading: "Loading…",
    unknown: "Unknown",
    listSeparator: ", ",
    slashSeparator: " / ",
    worksCount: { one: "{{count}} work", other: "{{count}} works" },
  },

  theme: {
    label: "Theme: {{current}} (switch to {{next}})",
    labelPending: "Switch theme",
    light: "Light",
    dark: "Dark",
    system: "Match system",
  },

  locale: {
    label: "Display language",
    // 言語名はその言語自身の表記で出すので、日本語辞書と同じ文字列にする
    ja: "日本語",
    en: "English",
  },

  notFound: {
    title: "Page not found",
    description:
      "The URL may have changed, or this voice actor or work has not been collected yet.",
    toTop: "Go to the top page",
  },

  errorScreen: {
    title: "Could not display this page",
    unknownCause: "The cause could not be identified.",
    retry: "Try again",
    toTop: "Go to the top page",
  },

  search: {
    label: "Find a voice actor to follow",
    placeholder: "Voice actor name (e.g. 上田麗奈)",
    searching: "Searching…",
    noResults: "No voice actor matched “{{query}}”.",
    resultsLabel: "Search results",
  },

  follow: {
    follow: "Follow",
    following: "Following",
    unfollow: "Unfollow",
  },

  home: {
    followPrompt:
      "Follow the voice actors you like and this turns into a feed of their new releases across DLsite and Audible. No account is needed, and follows are stored only in this browser.",
    latestTitle: "Latest releases (all voice actors)",
    latestEmptyTitle: "No releases yet",
    latestEmptyDescription: "Works will appear here once the crawler collects them.",
    actorDirectoryTitle: "All voice actors",
    feedTitle: "New from the voice actors you follow",
    feedSummary: {
      one: "Audio works released in the last {{days}} days or coming soon, from {{count}} voice actor you follow.",
      other:
        "Audio works released in the last {{days}} days or coming soon, from {{count}} voice actors you follow.",
    },
    feedErrorTitle: "Could not load the feed",
    feedErrorDescription: "Try reloading in a little while.",
    feedEmptyTitle: "Nothing new in this period",
    feedEmptyDescription: "Follow more voice actors, or come back later.",
    feedEmptyAction: "See the voice actors you follow",
    tierUpcoming: "Coming soon",
    tierRecent: "Released in the last {{days}} days",
    tierOlder: "Earlier (within {{days}} days)",
    tierExpand: "Expand",
    tierCollapse: "Collapse",
    seasonTitle: "Browse by {{season}} anime",
    seasonSeeAll: "See all ({{count}})",
  },

  following: {
    metaTitle: "Voice actors you follow | {{app}}",
    title: "Following",
    description:
      "Follows are stored only in this browser. They do not carry over to another device.",
    emptyTitle: "You are not following anyone yet",
    emptyDescription:
      "Search for a voice actor on the top page and follow them, and they will show up here and in your feed.",
    emptyAction: "Find voice actors",
    listLabel: "Voice actors you follow",
  },

  actor: {
    title: "New audio works by {{name}}",
    metaTitle: "New audio works by {{name}} | DLsite & Audible",
    metaDescription:
      "ASMR and voice works on DLsite and audiobooks on Audible featuring {{name}}, newest first.",
    subtitle: "Newest first, across DLsite and Audible",
    subtitleWithKana: "{{kana}} / Newest first, across DLsite and Audible",
    storeEmptyTitle: "Nothing found yet",
    storeEmptyDescription: "No works by this voice actor on {{store}} have been collected yet.",
    animeTitle: "Anime appearances",
  },

  work: {
    metaCast: "Featuring {{names}}. ",
    metaDescription:
      "“{{title}}” is a {{category}} audio work. Price, release date and running time. Available on {{stores}}.",
    makerName: "Circle / publisher",
    releaseDate: "Release date",
    duration: "Running time",
    castTitle: "Cast",
    castEmpty: "Credit information has not been collected.",
    purchaseTitle: "Where to buy",
    priceUnknown: "Price unknown",
    unavailable: "This may no longer be on sale.",
    priceSeenAt: "Price collected at {{at}}",
    badgeNew: "NEW",
    badgeUpcoming: "Releases {{date}}",
    unread: "Unread",
    noImage: "no image",
  },

  storeLink: {
    dlsite: "View on DLsite",
    audible: "Listen on Audible",
    missing: "No link to this store has been collected.",
  },

  category: {
    asmr: "ASMR",
    audio_drama: "Audio drama",
    audiobook: "Audiobook",
    situation_voice: "Situation voice",
    other: "Other",
  },

  format: {
    durationHoursMinutes: "{{hours}} hr {{minutes}} min",
    durationHours: "{{hours}} hr",
    durationMinutes: "{{minutes}} min",
  },

  season: {
    winter: "Winter",
    spring: "Spring",
    summer: "Summer",
    fall: "Fall",
    // 日本語と語順が逆になる ("2026 年秋" / "Fall 2026")
    label: "{{season}} {{year}}",
  },

  anime: {
    metaTitle: "Audio works by the cast of {{title}}",
    metaDescription: {
      one: "{{count}} voice actor from {{title}} who also releases ASMR, audiobooks or drama CDs, and how many works they have.",
      other:
        "{{count}} voice actors from {{title}} who also release ASMR, audiobooks or drama CDs, and how many works they have.",
    },
    castTitle: "Cast members who release audio works",
    subtitle: "{{season}} / {{english}}",
    hasAudioWorks: "Has audio works",
    workCount: "{{category}} {{count}}",
    roleMain: "Main",
    roleSupporting: "Supporting",
    actorCount: {
      one: "{{count}} cast member with audio works",
      other: "{{count}} cast members with audio works",
    },
    seasonMetaTitle: "Audio works by the cast of {{season}} anime",
    seasonMetaDescription:
      "Voice actors in {{season}} anime who also release ASMR, audiobooks or drama CDs, collected in one place.",
    seasonTitle: "{{season}} anime",
    seasonDescription: "Only shows anime whose cast members release audio works.",
    seasonEmptyTitle: "Nothing found yet",
    seasonEmptyDescription:
      "No cast members with audio works have been collected for {{season}} anime yet.",
  },

  admin: {
    unauthorizedTitle: "An admin token is required",
    unauthorizedConfigured:
      "Reopen this page with ?token=<ADMIN_TOKEN> appended to the URL. The token is stored in an HttpOnly cookie and removed from the URL.",
    unauthorizedMissing:
      "ADMIN_TOKEN is not set on the server. Set it with `wrangler secret put ADMIN_TOKEN` (or .dev.vars locally).",

    healthMetaTitle: "Crawler health | Admin",
    healthTitle: "Crawler health",
    // 件数が 1 でも 0 でも通る書き方にする (複数形の選択は count を渡すキーでしか効かない)
    healthSummary:
      "Last 24 hours: {{ok}} succeeded / {{error}} failed. Needs attention: {{warnings}}.",
    healthToUnmatched: "Go to unmatched credits",
    healthEmpty: "No crawl has been recorded yet.",
    healthColumnActor: "Voice actor",
    healthColumnStore: "Store",
    healthColumnLatestRun: "Latest run",
    healthColumnWorkCount: "Collected",
    healthColumnCoverage: "Coverage",
    healthColumnDiff: "Change",
    healthColumnNew: "New",
    healthColumnStatus: "Status",
    healthCoverageIncomplete: "The first page of search results did not cover everything",
    healthStatusError: "Failed",
    healthStatusWarning: "Check",
    healthStatusOk: "OK",

    unmatchedMetaTitle: "Unmatched credits | Admin",
    unmatchedTitle: "Unmatched credits",
    unmatchedSummary: {
      one: "{{count}} credited name is not linked to a voice actor.",
      other: "{{count}} credited names are not linked to a voice actor.",
    },
    unmatchedToHealth: "Go to crawler health",
    unmatchedEmpty: "There are no unmatched names.",
    unmatchedCount: { one: "{{count}} work", other: "{{count}} works" },
    unmatchedCandidate: "Candidate:",
    unmatchedNoCandidate: "No candidate. Pick one from the list.",
    unmatchedFilterLabel: "Filter voice actors",
    unmatchedFilterPlaceholder: "Name / kana",
    unmatchedSelectLabel: "Voice actor to assign",
    unmatchedSelectPlaceholder: "Select one",
    unmatchedAddAlias: "Register this name as an alias",
    unmatchedSaving: "Assigning…",
    unmatchedSubmit: { one: "Assign {{count}} work", other: "Assign {{count}} works" },
    unmatchedError: "Could not assign",
  },
};
