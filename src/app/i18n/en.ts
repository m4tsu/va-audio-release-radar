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
    name: "Koenect",
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
    disclaimer:
      "This is an unofficial service with no affiliation to any store. We do not guarantee that the information listed here is accurate or up to date. Please see each store for the details.",
    terms: "Terms of Service",
    privacy: "Privacy Policy",
    contact: "Contact",
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
    contactFormLink: "contact form",
  },

  contact: {
    title: "Contact",
    metaTitle: "Contact | {{app}}",
    metaDescription:
      "Send {{app}} a request, report a problem, or ask for listed content to be corrected or removed.",
    intro:
      "Send a request, report a problem, or get in touch about anything else. Individual replies are not guaranteed.",
    kindLabel: "Type",
    kindRequest: "Request",
    kindBug: "Problem",
    kindOther: "Other",
    bodyLabel: "Message",
    bodyHint: "Up to {{max}} characters",
    contactLabel: "How to reach you (optional)",
    contactHint: "Leave an email address or social account only if you need a reply.",
    submit: "Send",
    submitting: "Sending…",
    accepted: "Your message has been sent. Thank you.",
    errorBodyEmpty: "Enter a message.",
    errorBodyTooLong: "The message must be {{max}} characters or fewer.",
    errorContactTooLong: "The contact detail must be {{max}} characters or fewer.",
    errorPending: "Wait a moment for the bot check to finish.",
    errorRejected: "The bot check did not pass. Reload the page and try again.",
    errorUnavailable: "This form has not been set up to receive messages.",
    errorFailed: "The message could not be sent. Please try again later.",
    unavailable: "Messages cannot be sent from this page at the moment.",
    unavailableAlternative: "Please use the following contact point.",
    storageNote: "What you send is stored on the server.",
    turnstileNote: "This page loads Cloudflare's bot protection.",
    privacyLink: "Privacy Policy",
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
    heroTitle: "Find the audio works your favorite voice actors are in",
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
      "Every voice actor we track from anime. Pick a name to see their works, or follow someone whose first release is still to come.",
    title: "Voice actors",
    emptyTitle: "No voice actors found",
    sortName: "Name",
    sortWorkCount: "Most works",
    storeFilterLabel: "Filter by store",
    initialFilterLabel: "Filter by initial",
    filterAll: "All",
    shownCount: { one: "{{count}} voice actor", other: "{{count}} voice actors" },
    shownOfTotal: "{{count}} of {{total}} voice actors",
    showAll: "Show all",
    filteredEmptyTitle: "No voice actors have works on {{store}}",
  },

  actor: {
    title: "Audio works by {{name}}",
    metaTitle:
      "Audio works by {{name}} (ASMR, audiobooks, audio drama) | DLsite, Audible, Pocket Drama CD",
    metaDescription:
      "ASMR, audiobooks and audio dramas featuring {{name}} on DLsite, Audible and Pocket Drama CD, newest first.",
    storeEmptyTitle: "No works found on {{store}}",
    noWorksYetTitle: "No audio works found yet",
    noWorksYetDescription:
      "Follow this voice actor and their audio works will show up here once we find them.",
    filteredEmptyTitle: "No works with this cast size on {{store}}",
    partialCoverage: "Only part of this actor's works on {{store}} are listed here.",
    partialCoverageLink: "See all works on {{store}}",
    animeTitle: "Anime appearances",
  },

  work: {
    metaCast: "Featuring {{names}}. ",
    metaDescription:
      "“{{title}}” is a {{category}} audio work. Release date, running time and cast. Available on {{stores}}.",
    makerName: "Circle / publisher",
    releaseDate: "Release date",
    duration: "Running time",
    castTitle: "Cast",
    castEmpty: "No cast information available.",
    castMore: "+{{count}} more",
    purchaseTitle: "Where to buy",
    checkAtStore: "Check the store for the price and availability.",
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

  appearance: {
    solo: "Solo",
    small: "Small cast",
    large: "Large cast",
    unknown: "Cast unknown",
    filterLabel: "Cast size: {{name}}",
    filterAll: "All",
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
    castTitle: "Cast",
    subtitle: "{{season}} / {{alternate}}",
    noAudioWorksYet: "No audio works yet",
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
    seeWholeSeason: "See every title in this season",
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

    toHealth: "Go to crawler health",
    toUnmatched: "Go to unmatched credits",
    toInquiries: "Go to inquiries",

    healthMetaTitle: "Crawler health | Admin",
    healthTitle: "Crawler health",
    // 件数が 1 でも 0 でも通る書き方にする (複数形の選択は count を渡すキーでしか効かない)
    healthSummary:
      "Last 24 hours: {{ok}} succeeded / {{error}} failed. Needs attention: {{warnings}}.",
    healthEmpty: "No crawl has been recorded yet.",
    healthColumnActor: "Voice actor",
    healthFeedRun: "New releases feed",
    healthColumnStore: "Store",
    healthColumnLatestRun: "Latest run",
    healthColumnWorkCount: "Collected",
    healthColumnCoverage: "Coverage",
    healthColumnDiff: "Change",
    healthColumnNew: "New",
    healthColumnStatus: "Status",
    healthCoverageIncomplete: "This run did not cover everything",
    healthStatusError: "Failed",
    healthStatusWarning: "Check",
    healthStatusOk: "OK",

    unmatchedMetaTitle: "Unmatched credits | Admin",
    unmatchedTitle: "Unmatched credits",
    unmatchedSummary: {
      one: "{{count}} credited name is not linked to a voice actor.",
      other: "{{count}} credited names are not linked to a voice actor.",
    },
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

    inquiriesMetaTitle: "Inquiries | Admin",
    inquiriesTitle: "Inquiries",
    inquiriesSummary: {
      one: "Newest first. {{count}} inquiry on this page.",
      other: "Newest first. {{count}} inquiries on this page.",
    },
    inquiriesEmpty: "No inquiry has arrived yet.",
    inquiriesEmptyPage: "No inquiries on this page. Go back to the previous page.",
    inquiriesColumnReceivedAt: "Received",
    inquiriesColumnKind: "Kind",
    inquiriesColumnBody: "Message",
    inquiriesColumnContact: "Contact",
    inquiriesNoContact: "Not provided",
    inquiryKind: {
      request: "Request",
      bug: "Bug",
      other: "Other",
    },
    inquiriesPagination: "Inquiry pages",
    inquiriesPage: "Page {{page}}",
    inquiriesPrev: "Previous page",
    inquiriesNext: "Next page",
  },
};
