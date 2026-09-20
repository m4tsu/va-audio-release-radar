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
      "Follow your favorite voice actors and keep up with their new ASMR, audiobooks and audio dramas on DLsite, Audible and Pocket Drama CD.",
  },

  nav: {
    home: "Home",
    voiceActors: "Voice actors",
    anime: "Anime",
    following: "Following",
  },

  footer: {
    unofficial:
      "This is an unofficial service with no affiliation to any store. Work information is based on each store's public pages.",
    price:
      "Prices are as of when they were last checked. Please see each store for the current price and availability.",
    terms: "Terms of Service",
    privacy: "Privacy Policy",
  },

  legal: {
    termsTitle: "Terms of Service",
    termsMetaTitle: "Terms of Service | {{app}}",
    termsMetaDescription:
      "Conditions for using {{app}}: where the listed information comes from and how accurate it is, links to stores, disclaimers, and how to request corrections or removal.",
    privacyTitle: "Privacy Policy",
    privacyMetaTitle: "Privacy Policy | {{app}}",
    privacyMetaDescription:
      "What {{app}} stores in your browser, what is sent to its servers, and which third-party services your browser connects to.",
    effectiveDate: "Effective: {{date}}",
  },

  common: {
    loading: "Loading…",
    /** 並べ替えの読み上げ名。今の値を畳み込む (`components/sort-select.tsx`) */
    sortLabel: "Sort by: {{name}}",
    unknown: "Unknown",
    listSeparator: ", ",
    slashSeparator: " / ",
    worksCount: { one: "{{count}} work", other: "{{count}} works" },
  },

  theme: {
    switchToLight: "Switch to light theme",
    switchToDark: "Switch to dark theme",
    labelPending: "Switch theme",
  },

  locale: {
    label: "Display language: {{name}}",
    // 言語名はその言語自身の表記で出すので、日本語辞書と同じ文字列にする
    ja: "日本語",
    en: "English",
  },

  notFound: {
    title: "Page not found",
    description: "The URL may be wrong, or the page may have moved.",
    toTop: "Go to the top page",
  },

  errorScreen: {
    title: "Could not display this page",
    unknownCause: "An unexpected error occurred.",
    retry: "Try again",
    toTop: "Go to the top page",
  },

  search: {
    label: "Search by voice actor",
    searching: "Searching…",
    noResults: "No voice actor matched “{{query}}”.",
    resultsLabel: "Search results",
  },

  follow: {
    follow: "Follow",
    following: "Following",
    unfollow: "Unfollow",
    unfollowActor: "Unfollow {{name}}",
  },

  home: {
    heroTitle: "Your favorite voice actors' audio works, across every store",
    latestTitle: "New audio works",
    latestStoreTabsLabel: "Filter by store",
    latestStoreEmptyTitle: "No new releases on {{store}}",
    latestToFollowing: "New from your follows",
    browseTitle: "Other ways to browse",
    browseActorsTitle: "Browse voice actors",
    browseAnimeTitle: "Browse by anime",
  },

  following: {
    metaTitle: "New from the voice actors you follow | {{app}}",
    title: "Following",
    storageNote: "Saved in this browser only",
    manageTitle: {
      one: "{{count}} voice actor followed",
      other: "{{count}} voice actors followed",
    },
    listLabel: "Voice actors you follow",
    emptyTitle: "You are not following anyone yet",
    emptyAction: "Find voice actors",
    errorTitle: "Could not load new releases",
    errorDescription: "Please try reloading in a moment.",
    animeTitle: "Anime with voice actors you follow",
    feedEmptyTitle: "Nothing new in this period",
    feedEmptyAction: "Find voice actors",
    tierUpcoming: "Coming soon",
    tierRecent: "Released in the last {{days}} days",
    tierOlder: "Earlier (within {{days}} days)",
    tierExpand: "Expand",
    tierCollapse: "Collapse",
  },

  voiceActors: {
    metaTitle: "Voice actors | {{app}}",
    metaDescription:
      "Every voice actor with ASMR, audiobooks or audio dramas we have found. Pick a name to see their works.",
    title: "Voice actors",
    emptyTitle: "No voice actors found",
    sortName: "Name",
    sortWorkCount: "Most works",
    storeFilterLabel: "Filter by store",
    storeFilterAll: "All",
    shownCount: { one: "{{count}} voice actor", other: "{{count}} voice actors" },
    filteredEmptyTitle: "No voice actors have works on {{store}}",
  },

  actor: {
    title: "Audio works by {{name}}",
    metaTitle:
      "Audio works by {{name}} (ASMR, audiobooks, audio drama) | DLsite, Audible, Pocket Drama CD",
    metaDescription:
      "ASMR, audiobooks and audio dramas featuring {{name}} on DLsite, Audible and Pocket Drama CD, newest first.",
    storeEmptyTitle: "No works found on {{store}}",
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
    castEmpty: "No cast information available.",
    castMore: "+{{count}} more",
    purchaseTitle: "Where to buy",
    priceUnknown: "Price unknown",
    unavailable: "This may no longer be on sale.",
    priceSeenAt: "Price as of {{at}}",
    badgeNew: "NEW",
    badgeUpcoming: "Releases {{date}}",
    unread: "Unread",
    noImage: "no image",
  },

  storeLink: {
    dlsite: "View on DLsite",
    audible: "Listen on Audible",
    pokedora: "Listen on Pokedora",
    missing: "No link available.",
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
      one: "{{count}} voice actor from {{title}} with ASMR, audiobooks or audio dramas, and their works.",
      other:
        "{{count}} voice actors from {{title}} with ASMR, audiobooks or audio dramas, and their works.",
    },
    castTitle: "Cast with audio works",
    subtitle: "{{season}} / {{alternate}}",
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
      "Voice actors in {{season}} anime who have ASMR, audiobooks or audio dramas, all in one place.",
    seasonTitle: "{{season}} anime",
    sortPopularity: "Most popular",
    sortActorCount: "Most cast with audio works",
    seasonEmptyTitle: "No {{season}} anime",
    indexEmptyTitle: "No anime found",
    indexTitle: "Browse by anime",
    searchLabel: "Search by anime title",
    searchNoResults: "No anime matched “{{query}}”.",
    indexDescription: "Pick a season to see the anime that aired in it.",
    indexMetaTitle: "Browse voice actors' audio works by anime | {{app}}",
    indexMetaDescription:
      "Start from a season of anime and follow the cast's ASMR, audiobooks and audio dramas.",
    seasonListLabel: "Seasons",
    titleCount: { one: "{{count}} title", other: "{{count}} titles" },
    olderSeason: "Previous season ({{season}})",
    newerSeason: "Next season ({{season}})",
    allSeasons: "All seasons",
    followedFilterLabel: "Only titles with voice actors you follow",
    followedMark: "Includes a voice actor you follow",
    followedEmptyTitle: "No titles with voice actors you follow",
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
