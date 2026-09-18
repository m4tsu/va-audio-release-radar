# Voice Actor Audio Release Radar — Differentiation Spec

Date: 2026-09-18
Status: Product differentiation / development handoff

## 1. Product Positioning

Do not position this as:
- an ASMR recommendation site
- a voice actor encyclopedia
- a generic cross-store audio search engine
- a price tracker
- an anime cast database
- a social network
- an AI recommendation service

Core positioning:

> Follow voice actors once, then see their newly purchasable audio works, collaborations, and meaningful commercial updates across multiple stores.

Japanese shorthand:

> 推し声優をstore横断でfollowし、新着・共演・買い時をまとめて見る。

The persistent user entity is the voice actor, not the store.

## 2. Competitive Framing

### OshiKiku
Strong at:
- DLsite all-ages ASMR discovery
- voice actor search
- anime/game → cast → ASMR discovery
- track/content metadata

Weak relative to our target:
- primarily one-store / one-content-type oriented
- not a persistent cross-store follow feed
- not centered on cross-store commercial events

### KOE FOLIO
Strong at:
- anime role → voice actor
- voice actor → audiobook discovery
- Audible-oriented discovery
- multi-cast / narrator context

Weak relative to our target:
- not primarily a cross-store follower product
- not centered on recurring new-release monitoring
- not built around "my followed voice actors"

### Individual stores
Each store can answer:
> "What works by this person exist here?"

Our target answers:
> "What changed across all stores for the people I follow?"

## 3. Differentiation Thesis

Simple aggregation is insufficient.

Weak version:

```text
Voice actor
↓
DLsite works
Audible works
Pocket Drama works
```

Stronger version:

```text
My followed voice actors
          ↓
Cross-store changes
          ↓
New release
Sale
Free sample
Preorder
Subscription availability
Favorite co-star collaboration
          ↓
Actionable personal feed
```

The value comes from restructuring store data from the fan's point of view.

## 4. Pillar A — Multi-Favorite Collaboration Discovery

Users follow multiple voice actors.

When a work contains 2 or more followed actors, surface it prominently.

Example:

```text
Following:
✓ 斉藤壮馬
✓ 佐藤拓也
✓ 木村良平
✓ 石見舞菜香
```

Feed:

```text
★ 推し2人出演

25時、赤坂で
斉藤壮馬 / 佐藤拓也
Pocket Drama CD
```

This is deterministic personalization; no recommendation model is needed.

Suggested ranking:

```text
score =
  followed_actor_count * strong_weight
  + recency_weight
  + commercial_event_weight
```

MVP badge:

```text
★ 推し2人出演
```

Implementation is a simple set intersection between followed actor IDs and work credit IDs.

## 5. Pillar B — "How Much of This Voice Actor Do I Get?"

A binary credit is not enough for fans.

Examples:
- 8-hour solo narration
- 2-person main cast
- 20-person ensemble drama
- short guest role

Suggested structured attribute:

```ts
type AppearanceWeight =
  | "solo"
  | "main_duo"
  | "small_cast"
  | "ensemble"
  | "partial_narration"
  | "full_narration"
  | "unknown";
```

Possible UI:

```text
出演形態

● 単独出演
● 2人メイン
● 少人数キャスト
● 大人数キャスト
● 全編朗読
● 一部朗読
● 不明
```

Voice actor page filters:

```text
[すべて]
[単独]
[2人まで]
[少人数]
[全編朗読]
[大人数を除外]
```

Do not estimate exact speaking time. Only classify when public metadata supports it. Otherwise use `unknown`.

## 6. Pillar C — Commercial Event Feed

New releases alone may not generate enough repeat purchase opportunities.

Supported event types:

```ts
type CommercialEventType =
  | "new_release"
  | "preorder_open"
  | "sale_started"
  | "sale_ending"
  | "free_sample"
  | "subscription_added"
  | "subscription_removed"
  | "new_store_listing";
```

Example feed:

```text
今週の推しニュース

石見舞菜香
  NEW 1
  SALE 2

斉藤壮馬
  PREORDER 1
  FREE 1
```

Goal:

> Tell the user when there is a new reason to look at or buy a work.

This is important commercially because it creates affiliate opportunities without artificial recommendations.

## 7. Pillar D — Cross-Store Edition Comparison

Not MVP.

The same original work may have multiple audio adaptations.

Example:

```text
Original title X

Audible edition
Narrator: A
Format: narration
Duration: 9h12m

audiobook.jp edition
Cast: B / C / D
Format: audio drama
Duration: 7h40m
```

Potential comparison:

| Attribute | Audible | audiobook.jp |
|---|---|---|
| Cast | A | B / C / D |
| Format | Narration | Audio drama |
| Duration | 9h12m | 7h40m |
| Followed actor | Full narration | Partial |
| Access | Subscription / purchase | Purchase |

Implement only after cross-store work identity resolution is reliable.

## 8. Core Home Experience

The product should behave primarily as a feed, not a database.

```text
My Voice Feed

★ 推し2人出演
NEW
作品A
斉藤壮馬 / 佐藤拓也
Pocket Drama CD

SALE 50%
作品B
石見舞菜香
DLsite
単独出演

PREORDER
作品C
木村良平
Release: Oct 24
```

Default ordering:
1. multiple followed actors
2. new releases
3. strong commercial events
4. standard recent additions

## 9. Voice Actor Page

Example:

```text
石見舞菜香

42 purchasable audio works
across 3 stores

[Follow]

Filters
[新着]
[単独・メイン]
[ASMR]
[朗読]
[ドラマCD]
[セール中]

Stores
DLsite        21
Pocket Drama  14
Audible         7
```

The page should be useful without login and become more useful after following actors.

## 10. Recommended MVP

Must-have:
1. Cross-store actor page
2. Follow / unfollow actor
3. Unified new-release feed
4. Multi-follow collaboration badge
5. Basic appearance-weight classification where reliable

The collaboration badge should be in MVP because it is cheap, objectively correct, and clearly differentiated.

## 11. Phase 1.5

After MVP works:
- weekly email digest
- sale events
- preorder events
- format filters
- seen/unseen state
- Pocket Drama CD source

## 12. Phase 2

Only after traffic and click behavior validate the product:
- audiobook.jp
- subscription availability changes
- cross-store same-work comparison
- anime / character landing pages
- work-level cross-store merging
- detailed appearance-weight categories

## 13. Explicitly Excluded Features

Do not add initially:
- AI recommendations
- similar voice actor recommendations
- user reviews
- ratings
- comments
- social graph
- collection management
- purchase history
- complex tagging
- folders
- planning
- streaming player
- price prediction
- speculative alias matching
- adult identity inference
- exact speaking-time estimation

## 14. Product Differentiation Summary

```text
OshiKiku
= Find DLsite ASMR through voice actors / anime

KOE FOLIO
= Find audiobooks through anime roles / narrators

DLsite / Pocket Drama / Audible
= Search within one store

Price tracker
= Track one work's price

Our target
= Follow people once
+ see new purchasable audio works across stores
+ surface works containing multiple favorites
+ show whether the favorite is a major or minor participant
+ notify when a meaningful buying event happens
```

## 15. Strongest Differentiators

Priority order:

### 1. Multi-favorite collaboration
> "Two of the voice actors I follow are in the same work."

High value, low implementation complexity.

### 2. Appearance weight
> "Is my favorite actually central to this work?"

High fan value, moderate metadata complexity.

### 3. Commercial events
> "Something changed that makes this worth checking now."

High affiliate value, higher crawler complexity.

### 4. Cross-store edition comparison
> "Which audio version is better for the cast I care about?"

High purchase value, high entity-matching complexity.

## 16. Development Decision Rule

When considering a new feature, ask:

> Can this feature exist because we know the user's followed voice actors across stores?

If no, it is probably generic and not a priority.

Good:
```text
2 followed actors appear together
```

Good:
```text
followed actor's old work goes on sale
```

Good:
```text
followed actor narrates full Audible edition but only guest-stars in another edition
```

Weak:
```text
popular ASMR ranking
```

Weak:
```text
generic new-release page
```

Weak:
```text
AI recommends similar works
```

## 17. Validation Metrics

### Collaboration engagement

Compare outbound CTR for:
- 2+ followed actors
- single followed actor

If collaboration items perform much better, the feature is validated.

### Appearance-weight engagement

Compare store CTR for:
- solo / full narration
- small cast
- ensemble
- unknown

### Commercial-event engagement

Measure:
- new release CTR
- sale CTR
- preorder CTR
- free sample CTR

This determines which event types justify crawler complexity.

## 18. Product Hypothesis

Central hypothesis:

> Voice actor fans care less about "all products in this category" and more about "what changed for the specific people I already care about."

Optimize:

```text
Person
→ follow
→ recurring changes
→ purchase opportunity
```

rather than:

```text
Catalog
→ recommendation
→ browse endlessly
```

## 19. Short Implementation Priority

```text
P0
- actor entity
- store listings
- follow state
- unified feed

P1
- multi-follow collaboration detection
- basic appearance-weight metadata

P2
- sale / preorder / free-sample events
- weekly digest

P3
- Pocket Drama CD
- audiobook.jp
- cross-store same-work matching
```

## 20. Final Product Principle

> Do not try to beat each store at search.
>
> Build the layer that no individual store can naturally own:
> **the user's relationship with voice actors across stores.**
