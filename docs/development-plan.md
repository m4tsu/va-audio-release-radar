# Voice Actor Audio Release Radar — Development Plan

Date: 2026-09-18  
Status: MVP candidate  
Working title: **Voice Actor Audio Release Radar**

---

# 1. Product Summary

## One-line concept

> **好きな声優をfollowすると、複数の音声販売サービスを横断して、新しく買える音声作品だけを一か所で追えるWebサービス。**

対象となる主な音声コンテンツ:

- DLsite 全年齢音声 / ASMR
- Audible
- 将来的に:
  - ポケットドラマCD
  - audiobook.jp
  - その他公式音声販売サービス

中心価値はrecommendationではない。

> **「この声優の新しい音声作品が出た」という事実を、store横断で取りこぼさず知る。**

---

# 2. Product Thesis

現在、ユーザーは各storeごとに声優を探す必要がある。

```text
DLsite
→ DLsite内で検索 / follow

Audible
→ narrator search

ポケットドラマCD
→ 声優tag / favorite

audiobook.jp
→ 別途検索
```

問題は、

> **「声優をfollowする」というuser stateがstoreごとに分断されていること。**

本サービスではfollow対象をstoreから切り離す。

```text
Voice Actor
   ↓
Follow once
   ↓
DLsite
Audible
Pocket Drama CD
audiobook.jp
   ↓
One release feed
```

---

# 3. Why This Product

## Strong points

- 同じユーザーが同じ声優を長期間追う
- 音声作品は継続的に新作が出る
- purchase intentが高い
- affiliate導線が自然
- recommendation engineが不要
- follow + new release なので価値判定が客観的
- subscription課金を自社で取らなくても収益化可能
- product DBを一から人力作成する必要はない
- 「声優名 + ASMR / Audible / 朗読」系検索流入を狙える

## Weak points

- 各storeに安定したpublic APIがない
- crawler / parser保守が必要
- 声優名の表記揺れ
- 同名人物 / 名義問題
- affiliate programの条件変更
- 競合が2026年に増え始めている

---

# 4. Competitive Context

## OshiKiku

- DLsite全年齢ASMR中心
- 声優から検索
- アニメ / ゲーム作品から声優へ辿れる
- role情報との接続あり

Implication:

> **「アニメ出演声優 → DLsite ASMR」だけでは差別化にならない。**

---

## KOE FOLIO

- 2026年公開の小規模新規サービス
- アニメ作品 / 役名 → 声優
- Audible等の音声作品へ接続

Implication:

> 「声優 → Audible」単体も既に競合が出始めている。

---

## Remaining wedge

> **声優を中心entityとして、複数storeの購入可能な音声作品を横断followする。**

差別化は:

- store cross-over
- persistent follow
- new-release feed
- purchase destination aggregation

---

# 5. MVP Scope

## Initial supported stores

### Phase 1

1. **DLsite**
2. **Audible Japan**

### Phase 2

3. ポケットドラマCD
4. audiobook.jp

最初から4storeに対応しない。

理由:

- crawler保守面積を減らす
- voice actor entity mergeを先に検証する
- affiliate click-throughが発生するかを見る

---

## Initial voice actors

**50〜100人**

選定基準:

- 現在アニメ出演が多い
- DLsite全年齢音声への出演が確認できる
- Audible narrator実績がある
- 検索需要がありそう
- 同名問題が少ない

MVPでは完全網羅を目指さない。

---

## Initial catalog horizon

- 直近90日
- 今日以降の新着

過去10年分を収集しない。

目的は:

> archive database

ではなく:

> **new release radar**

だから。

---

# 6. Core User Flow

## First visit

```text
Search voice actor
      ↓
Follow
      ↓
Repeat 3–10 times
      ↓
Open home feed
```

Example:

```text
Following

上田麗奈
石見舞菜香
鬼頭明里
長谷川育美
```

---

## Home

```text
New this week

上田麗奈
Audible
「XXXX」
朗読 / 8h12m
NEW

石見舞菜香
DLsite
「XXXX ASMR」
ASMR / 1h26m
¥1,980
NEW

長谷川育美
DLsite
「XXXX」
Voice Drama
¥1,430
NEW
```

Actions:

- Open detail
- Go to store
- Mark seen
- Follow / unfollow actor

---

# 7. Product Principles

## 7.1 No recommendation requirement

Do not start with:

- AI recommendation
- similarity ranking
- taste prediction
- collaborative filtering

The product should already work with:

```text
I like this person
→ tell me when something new appears
```

---

## 7.2 Do not require management work

Avoid:

- complex collections
- rating systems
- manual purchase history
- tagging
- folders
- planning

Only required user action:

> **follow a voice actor**

---

## 7.3 Facts over guesses

Only connect identities when there is reliable evidence.

Do not infer:

- hidden aliases
- adult aliases
- stage-name equivalence
- anonymous creators

especially when the connection is not officially public.

Store credit names should remain as-is unless publicly verified.

---

# 8. Data Model

## VoiceActor

```ts
type VoiceActor = {
  id: string
  canonicalName: string
  nameKana?: string

  anilistStaffId?: number

  aliases: VoiceActorAlias[]

  imageUrl?: string

  status: "active" | "inactive" | "unknown"

  createdAt: Date
  updatedAt: Date
}
```

---

## VoiceActorAlias

```ts
type VoiceActorAlias = {
  id: string
  voiceActorId: string

  name: string
  source: "manual" | "anilist" | "store"
  verified: boolean
}
```

Important:

> Alias should only represent publicly verifiable name variations.

Do not use it for speculative identity linking.

---

## Store

```ts
type Store = {
  id: string
  slug: "dlsite" | "audible" | "pokedora" | "audiobookjp"

  name: string
  baseUrl: string

  affiliateEnabled: boolean
}
```

---

## AudioWork

```ts
type AudioWork = {
  id: string
  title: string

  category:
    | "asmr"
    | "audio_drama"
    | "audiobook"
    | "situation_voice"
    | "other"

  releaseDate?: Date

  coverImageUrl?: string

  durationSeconds?: number

  adult: boolean

  createdAt: Date
  updatedAt: Date
}
```

---

## StoreListing

One audio work can exist on multiple stores.

```ts
type StoreListing = {
  id: string

  audioWorkId: string
  storeId: string

  storeProductId: string
  productUrl: string
  affiliateUrl?: string

  titleRaw: string

  price?: number
  currency: "JPY"

  available: boolean

  firstSeenAt: Date
  lastSeenAt: Date
  lastCheckedAt: Date
}
```

---

## Credit

```ts
type AudioCredit = {
  id: string

  audioWorkId: string
  voiceActorId?: string

  creditedName: string

  role?: string

  confidence: "verified" | "probable" | "unmatched"

  sourceStoreId: string
}
```

---

## Follow

```ts
type Follow = {
  userId: string
  voiceActorId: string
  createdAt: Date
}
```

---

# 9. Voice Actor Identity Matching

This is one of the most important technical problems.

## Matching pipeline

### Step 1 — exact canonical name

```text
store credit
==
VoiceActor.canonicalName
```

→ auto match

### Step 2 — verified alias

```text
store credit
==
VoiceActorAlias.name
```

→ auto match

### Step 3 — normalized string

Normalize:

- spaces
- full-width / half-width
- middle dots
- punctuation
- kana variants where safe

Example:

```text
上田 麗奈
上田麗奈
```

→ same

### Step 4 — unresolved queue

Never blindly let LLM merge identities.

```text
Unmatched:
"XXXX"

Candidates:
A
B
C
```

Admin confirms manually.

Because MVP only covers 50–100 actors, this queue should remain manageable.

---

# 10. DLsite Data Acquisition

## Current situation

DLsite has an affiliate program.

However, there is no generally documented public product API intended for arbitrary third-party product databases.

Internal / unofficial JSON endpoints exist and community wrappers demonstrate that fields such as:

- title
- circle
- creator / voice actor
- price
- release date
- genre
- rating
- sales count

can be retrieved.

---

## MVP acquisition strategy

Prefer:

```text
known voice actor
↓
DLsite public search / listing
↓
collect product IDs
↓
fetch detail / JSON
↓
normalize
```

Do not crawl the entire DLsite catalog.

Only query:

> the 50–100 tracked voice actors.

This dramatically reduces:

- traffic
- storage
- maintenance
- irrelevant data

---

## Refresh cadence

Suggested:

```text
Popular actor:
every 6–12h

Other actor:
every 24h
```

No need for real-time monitoring.

---

# 11. Audible Data Acquisition

## MVP strategy

Use narrator-based public search pages.

Example concept:

```text
searchNarrator=上田麗奈
```

Store:

- title
- narrator
- author
- release / publication data when available
- duration
- product URL
- cover

---

## Limitation

No general public Audible catalog API was confirmed.

Therefore:

- parser maintenance required
- aggressively limit query surface
- 50–100 narrator pages only

---

# 12. AniList Integration

Use AniList only as a convenience layer for:

- anime appearances
- characters
- recognizable role examples

Possible data:

```text
VoiceActor
↓
Known for
- Anime A / Character A
- Anime B / Character B
- Anime C / Character C
```

This helps users identify:

> 「名前は覚えていないけど、あのキャラの声」

AniList data must not become a hard architectural dependency.

Model:

```text
VoiceActor canonical DB
= own DB

AniList
= optional enrichment layer
```

---

# 13. Pages

## Home

Route:

```text
/
```

Logged out:

- search
- popular actors
- recent cross-store releases

Logged in:

- followed actor feed

---

## Voice Actor Page

Route:

```text
/voice-actors/{slug}
```

Example:

```text
上田麗奈

Known for
[anime roles]

Latest audio works

DLsite
...

Audible
...

[Follow]
```

This page should be indexable for SEO.

---

## Work Page

Route:

```text
/works/{id}
```

Contents:

- title
- cover
- credits
- store availability
- price
- category
- release date

CTA:

```text
DLsiteで見る
Audibleで見る
```

---

# 14. SEO Strategy

Do not attempt broad keywords like:

```text
ASMR おすすめ
Audible おすすめ
```

Too competitive and editorial.

Target entity queries.

Examples:

```text
上田麗奈 ASMR
上田麗奈 Audible
上田麗奈 朗読

石見舞菜香 ASMR
鬼頭明里 Audible
長谷川育美 音声作品

ぼっちざろっく 声優 ASMR
フリーレン 声優 Audible
```

The advantage is that pages are generated from structured data rather than manually written SEO articles.

---

# 15. Affiliate Design

## General principle

Affiliate links should appear exactly where purchase intent is strongest.

Not:

```text
random ads
```

But:

```text
this work is available here
→ store
```

---

## DLsite

Use official affiliate program.

Store both:

```text
canonical product URL
affiliate URL
```

Do not make affiliate URL the source identifier.

---

## Audible

Primary value may be:

> new Premium membership

rather than individual audiobook purchase commission.

Potential CTA:

```text
Audibleで聴く
```

---

# 16. Authentication

MVP recommendation:

- browsing / search: no account
- follows: initially local browser state
- account only when user wants sync or notifications

Do not force signup before value is visible.

---

# 17. Notifications

Not required for first public MVP.

Phase 1:

> feed only

Phase 1.5:

> weekly email digest

Example:

```text
今週の新着

上田麗奈 2作品
石見舞菜香 1作品
長谷川育美 3作品
```

Avoid real-time notification spam.

---

# 18. Architecture

Suggested stack:

```text
Frontend
Next.js

Backend
Next.js API / lightweight Node service

Database
PostgreSQL

Crawler workers
Node.js / TypeScript
or
Python

Scheduler
cron / GitHub Actions / server jobs
```

Suggested deployment:

```text
Vercel
+
Supabase / Neon
+
GitHub Actions crawler
```

Do not introduce:

- Kafka
- Redis queue
- microservices
- complex event systems

unless actual volume demands it.

---

# 19. Crawler Architecture

```text
Scheduler
  ↓
Source Adapter
  ↓
Raw Parsed Result
  ↓
Normalizer
  ↓
Identity Resolver
  ↓
Database Upsert
  ↓
New Listing Detector
```

Adapter concept:

```ts
interface SourceAdapter {
  source: StoreSlug
  fetchByActor(actor: VoiceActor): Promise<RawWork[]>
  parseWork(raw: unknown): RawWork
}
```

Each store should be isolated.

```text
adapters/
  dlsite.ts
  audible.ts
  pokedora.ts
  audiobookjp.ts
```

---

# 20. Raw Snapshot Storage

When possible, save lightweight raw snapshots for debugging.

Example:

```text
crawler_snapshots

source
request_key
fetched_at
payload_hash
raw_json / html path
```

Reason:

When parser suddenly returns 0 products, it should be possible to determine whether:

- source changed
- parser broke
- actor genuinely has no results

---

# 21. Automated Data Quality Checks

Examples:

```text
tracked actor had 18 works yesterday
today = 0

→ alert
```

```text
DLsite median product count:
previous 50
today 3

→ parser failure suspected
```

```text
release date 1970
→ invalid
```

The system should detect crawler breakage before users do.

---

# 22. Admin Tool

Minimal internal admin page:

```text
/admin/unmatched-credits
/admin/crawler-health
/admin/voice-actors
```

Main tasks:

- resolve unmatched names
- inspect scraper failures
- disable incorrect work
- merge duplicates
- edit canonical actor

Keep manual work focused on exceptions.

---

# 23. Duplicate Work Detection

Same work may appear across stores.

MVP:

Do not aggressively merge.

Treat store listings as separate works unless confident.

Phase 2 merge signals:

- exact title
- same creator
- same voice actor
- similar release date
- shared external ID when available

False merges are worse than duplicates.

---

# 24. Search

MVP:

```text
voice actor name
kana
known anime character
```

Optional fuzzy search.

Do not build semantic/vector search initially.

---

# 25. Privacy

User data:

```text
followed voice actors
seen feed items
email address if notifications enabled
```

No need to collect:

- purchase history
- browsing history
- preference profile
- payment information

Keep the system intentionally low-data.

---

# 26. Adult-content Boundary

MVP recommendation:

> **Start with publicly credited, non-adult / all-ages audio works.**

Reasons:

- simpler identity handling
- avoids alias speculation
- lower moderation complexity
- easier SEO / hosting / affiliate operation

If adult catalog is later added:

- separate age-gated surface
- do not infer alias identities
- use store-provided public credit only
- review affiliate / hosting terms

---

# 27. MVP Feature List

## Must-have

- voice actor search
- actor profile
- follow / unfollow
- DLsite new releases
- Audible new releases
- unified feed
- store links
- affiliate links
- basic crawler health monitoring

## Nice-to-have

- known anime roles
- weekly email digest
- release category filter
- seen / unread state
- popular actors
- latest releases page

## Do NOT build initially

- AI recommendation
- ratings
- social feed
- comments
- purchase history
- user collections
- complex tag system
- planning
- personalized similarity
- mobile app
- full historical catalog
- all Japanese voice actors
- adult alias matching

---

# 28. MVP Milestones

## Milestone 1 — Data spike

Goal:

> Can we reliably retrieve products for 10 actors?

Implement:

- 5 DLsite actors
- 5 Audible actors
- parser
- normalization
- simple CLI output

Success:

```text
actor
→ products
→ title
→ release date
→ URL
```

Failure condition:

- data extraction too fragile
- anti-bot prevents reliable use
- terms make commercial use impractical

---

## Milestone 2 — Entity DB

- VoiceActor
- AudioWork
- StoreListing
- AudioCredit

Seed:

50 actors.

---

## Milestone 3 — Public actor pages

```text
/voice-actors/{slug}
```

Indexable.

No account required.

---

## Milestone 4 — Follow feed

Anonymous follow via browser.

```text
/following
```

---

## Milestone 5 — Affiliate links

Measure:

```text
page views
store outbound clicks
CTR
```

---

## Milestone 6 — Search indexing

Submit sitemap.

Observe:

- indexed actor pages
- impressions
- queries
- clicks

---

# 29. Primary Validation Metrics

The product should initially validate **traffic and purchase intent**, not subscription retention.

## SEO

```text
Google impressions
organic clicks
actor page indexed count
queries per actor
```

## Product

```text
voice actor follows / visitor
return visitors
feed views
```

## Commercial

Most important:

```text
store outbound CTR
affiliate conversion
revenue per 1,000 organic visitors
```

---

# 30. Strong Signals

Good:

- users follow 3+ actors
- visitors return when new works appear
- actor pages receive long-tail search impressions
- outbound store CTR is meaningful
- revenue happens without paid acquisition

Very strong:

> users search directly for the service name + actor name.

---

# 31. Kill Criteria

Stop or substantially change direction if:

## Data failure

- crawler maintenance consumes too much time
- store markup breaks frequently
- product extraction becomes legally / technically unreliable

## Traffic failure

After sufficient indexing:

- actor pages receive almost no search impressions
- entity keywords are dominated by large sites with no room

## Product failure

- users visit actor page but rarely follow
- follow users do not return
- feed is too sparse

## Commercial failure

- outbound click-through exists but affiliate conversion is negligible
- effective revenue per visitor is too low to justify crawler maintenance

---

# 32. Expansion Paths

Only after MVP signal.

## 32.1 Pocket Drama CD

Add third store.

## 32.2 audiobook.jp

Add fourth store.

## 32.3 Anime entry pages

```text
Anime
→ cast
→ purchasable audio works
```

## 32.4 Character entry pages

```text
Character
→ Japanese VA
→ audio works
```

## 32.5 Weekly digest

Email:

```text
3 new works from actors you follow
```

## 32.6 Price / sale tracking

Only if source data is reliable.

Do not build initially.

---

# 33. Possible Naming Directions

Avoid names too tied to one store.

Possible concepts:

- VoiceRadar
- KoeRadar
- KoeFeed
- VoiceShelf
- KoeRelease
- VoiceDrop
- KoeWatch

The product name should communicate:

> 声優 × 新着音声

rather than:

> ASMR only

because future sources include audiobooks and drama CDs.

---

# 34. First Technical Spike

Before designing UI, implement this CLI:

```bash
$ radar actor "上田麗奈"
```

Expected output:

```text
DLsite
2026-09-10  XXXXX
2026-08-28  XXXXX

Audible
2026-09-05  XXXXX
2026-07-19  XXXXX
```

Then:

```bash
$ radar diff "上田麗奈"
```

Output:

```text
New since previous crawl:
+ DLsite XXXXX
+ Audible XXXXX
```

If this works reliably for 10–20 actors for several days, move to Web UI.

---

# 35. Recommended Development Order

```text
1. DLsite data spike
2. Audible data spike
3. normalized voice actor identity
4. 20 actors
5. daily crawler
6. diff detection
7. actor profile page
8. sitemap / SEO
9. follow state
10. unified feed
11. affiliate URLs
12. analytics
13. expand to 50–100 actors
14. only then add third store
```

---

# 36. Main Risk Register

| Risk | Severity | Mitigation |
|---|---:|---|
| DLsite unofficial data access breaks | High | adapter isolation, small crawl surface, snapshots |
| Audible markup changes | Medium | parser tests, query only tracked actors |
| Voice actor name ambiguity | Medium | verified alias table + manual queue |
| Competitor launches cross-store follow | Medium | ship early, SEO entity pages |
| Affiliate terms change | Medium | multiple stores |
| SEO traffic weak | High | validate with 50–100 pages before expansion |
| Catalog too sparse | Medium | choose actors with cross-store presence |
| Manual moderation grows | Medium | only handle unmatched exceptions |
| Adult alias identity errors | High | do not infer aliases |

---

# 37. GO / NO-GO Gate

Before spending significant time, require all of:

- [ ] DLsite extraction reliable for 20 actors
- [ ] Audible extraction reliable for 20 actors
- [ ] daily crawler survives 7+ days
- [ ] name matching accuracy acceptable
- [ ] affiliate participation available
- [ ] 50 actor pages can be generated automatically
- [ ] no major legal / ToS blocker discovered

Then launch public MVP.

After launch, continue only if at least one of:

- organic impressions begin growing
- return users appear
- affiliate outbound CTR is promising
- users request more actors / stores

---

# 38. Current Recommendation

Build this as:

> **an SEO-indexable, cross-store voice-actor release feed**

not:

- an ASMR recommendation site
- a voice actor encyclopedia
- a social network
- a subscription management app
- an AI discovery engine

The initial product should be deliberately narrow:

> **Follow a voice actor. See their newest purchasable audio works across stores.**

If this behavior works, the catalog and acquisition surfaces can expand later.

---

# 39. Reference Sources

Competitive / adjacent:

- OshiKiku  
  https://oshikiku.com/

- KOE FOLIO  
  https://www.arc-folio.com/koefolio/

- Pocket Drama CD voice actor tags  
  https://pokedora.com/tags/

- DLsite Sound  
  https://apps.apple.com/jp/app/dlsite-sound-%E9%9F%B3%E5%A3%B0%E4%BD%9C%E5%93%81%E3%83%97%E3%83%AC%E3%82%A4%E3%83%A4%E3%83%BC/id1639830903

Data / APIs:

- AniList API  
  https://docs.anilist.co/

- Unofficial DLsite API wrapper example  
  https://github.com/RoxyCoding/DLsite-API

Affiliate:

- DLsite affiliate information  
  https://www.dlsite.com/home/guide/affiliate

- Pocket Drama CD affiliate FAQ  
  https://pokedora.com/faq/?id=7

- Amazon Associates / Audible  
  https://affiliate.amazon.co.jp/

- audiobook.jp affiliate help  
  https://otobankhelp.zendesk.com/hc/ja/articles/360001749814-%E3%82%A2%E3%83%95%E3%82%A3%E3%83%AA%E3%82%A8%E3%82%A4%E3%83%88%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6
