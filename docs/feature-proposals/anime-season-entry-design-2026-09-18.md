# 今期アニメからの入口 — 設計

Date: 2026-09-18
Status: 設計 / 実装前。レビュー待ち
Scope: `anime-season-entry-2026-09-18.md` の案を実装可能な粒度に落としたもの。
採用が決まったら `design/architecture.md` に畳み込む。

推測には「（推測）」と明記する。

---

## 1. 前提 (コードと AniList の実応答で確認した)

### 既にあるもの

| 資産 | 場所 | 内容 |
|---|---|---|
| アニメ出演データ | `crawler/.cache/discovery/anilist-credits.json` | **15,923 件**。`mediaId` / `staffId` / `nativeName` / `role` (MAIN・SUPPORTING) / `season` |
| 取得クエリ | `crawler/discovery/anilist.ts` の `SEASON_PAGE_QUERY` | 作品 ID とキャラクター edge を取得済み |
| 対象声優 | `crawler/actors.generated.json` | 2,569 人。`anilistStaffId` と英語名 (`fullName`) を持つ |

### AniList から取れるもの (2026-09-18 実応答で確認)

| 項目 | 結果 |
|---|---|
| `title.native` | 全件あり |
| `title.romaji` | 全件あり |
| `title.english` | **null のことがある** (5 件中 1 件。「メイドインアビス 目覚める神秘」) |
| `coverImage.large` / `.medium` | 全件あり |
| キャラクター `name.native` / `name.full` | 全件あり (壬氏 / Jinshi、猫猫 / Maomao) |
| キャラクター `image.medium` | 全件あり |
| 声優 `image.medium` | 取得可能 |

**日英両方のデータが 1 リクエストで揃う。** リクエスト数は増えず、取得項目が増えるだけ。

### 欠けているもの

1. **アニメのタイトルが残っていない。** `parseSeasonPage` は `title.native` を取り出しているが、
   `AniListPhaseResult` に含まれず集計後に捨てられる
2. **アニメ作品とキャラクターを保存する場所が無い**
3. **取り込み経路が無い。** `crawler/discovery/run.ts` は「DB には一切書き込まない」設計

---

## 2. AniList の利用条件 (一次情報で確認した)

出典: <https://raw.githubusercontent.com/AniList/docs/master/docs/guide/terms-of-use.md>

| 条項 | 内容 | 本プロジェクトへの影響 |
|---|---|---|
| **商用利用** | 月 **$150 未満**の収益なら無償。超える場合は商用ライセンスの取得が必要 (`contact@anilist.co`) | **アフィリエイト収益が $150/月 を超えた時点で問い合わせが要る**。事業計画に組み込む |
| **Hoarding の禁止** | 「Hoarding or mass collection of data from the AniList API is strictly prohibited」 | **対象声優が演じたキャラだけを保存する**。全キャラを取らない (§5 の歯止め 3) |
| **ストレージ用途の禁止** | API をバックアップ / データストレージとして使うことは禁止 | 表示に要る項目だけを保存する |
| **競合サービスでの利用禁止** | 「anime and manga list or tracker services」での利用は不可 | 本プロジェクトは音声作品のレーダーであり、アニメ / マンガのリスト管理ではない（推測。判断はユーザー） |
| **名称ガイドライン** | 名前に "AniList" / "AniChart" を含める場合の規定 | 使っていないので該当なし |

**出典表示 (attribution) の義務は書かれていない。画像の利用に関する規定も無い。**

画像は URL を保存して参照する。自前で再配信するとストレージ用途に近づくため。
これは DLsite・ポケドラで採っている「メタデータの参照とリンクに留める」方針
(`research/adult-scope-2026-09-18.md` §3-(c)-7) とも一致する。

---

## 3. データモデル

テーブルを 2 つ足し、既存テーブルに 1 列足す。

### `anime_titles`

| 列 | 内容 |
|---|---|
| `id` | `anilist:{mediaId}` |
| `slug` | URL に出る文字列。§6 |
| `title_native` | 日本語タイトル |
| `title_romaji` | ローマ字。slug の元でもある |
| `title_english` | 英語タイトル。**null がある** |
| `season_year` / `season` | 2026 / FALL |
| `cover_image_url` | AniList の CDN URL |
| `created_at` / `updated_at` | |

英語タイトルが null のときの表示は `title_english ?? title_romaji`。

### `anime_appearances`

アニメ × キャラクター × 声優の 1 行。キャラクター情報はこの行に持つ。

| 列 | 内容 |
|---|---|
| `anime_title_id` | → `anime_titles.id` |
| `voice_actor_id` | → `voice_actors.id` |
| `character_id` | `anilist:{characterId}` |
| `character_name_native` | 壬氏 |
| `character_name_full` | Jinshi (英語表記) |
| `character_image_url` | AniList の CDN URL |
| `role` | `main` / `supporting` |

一意キーは `(anime_title_id, character_id, voice_actor_id)`。
1 人が 1 作品で複数キャラを演じることがあるので、`(作品, 声優)` では一意にならない。

**キャラクターを別テーブルに分けない。** キャラクターは「このアニメで、この声優が」という文脈でしか
使わないので、edge に持たせる。同一キャラが続編に出る場合は `mediaId` が違うので別の行になり、
それが正しい (シーズンごとに別の作品として扱う)。

索引は `anime_title_id` と `voice_actor_id` の両方向。

### `voice_actors` への追加

| 列 | 理由 |
|---|---|
| `name_en` | 英語名 (`Reina Ueda`)。`actors.generated.json` の `fullName` から入る。現在 DB に無く、slug からの復元は表示に向かない |

### 持たないもの

- **アニメの情報そのもの**。あらすじ・話数・放送局・スタッフ・放送日時
- **対象声優が演じていないキャラクター**。§2 の Hoarding 禁止に整合させる

### `audio_works` とは結ばない

アニメと音声作品を直接結ぶ関係は作らない。結節点は常に声優。
「この声優はこのアニメに出ていて、この音声作品にも出ている」という 2 ホップだけを成立させる。
直接結ぶと「アニメ関連の音声作品」という別の製品になる。

---

## 4. 取得と更新

### 取得

`SEASON_PAGE_QUERY` に取得項目を足す。リクエスト数は増えない。

```text
title { native romaji english }
coverImage { large }
characters(perPage: 25, sort: ROLE) {
  edges {
    role
    node { id name { native full } image { medium } }
    voiceActors(language: JAPANESE) { id name { native full } image { medium } }
  }
}
```

`node { id }` を消すと `voiceActors` が全件 null で返る既知の罠 (`anilist.ts` の冒頭コメント) は
そのまま。`name` や `image` を足しても同じ条件で動く。

`AniListPhaseResult` に `media` を持たせて、タイトルが捨てられないようにする。

### 取り込み

`run.ts` の「DB に書かない」性質は維持する。

- discovery が `crawler/anime.generated.json` を出す (`actors.generated.json` と同じ形)
- 管理 API 経由で取り込む (既存の ingest と同じ認証)

### 更新頻度

**毎クール 1 回。** 日次のストアクロール (`.github/workflows/crawl.yml`) には乗せない。
放送中のアニメが変わるときにだけ入れ替わる。

---

## 5. 事典にしないための歯止め

`architecture.md` §1 は「アニメのキャスト DB ではない」としている。守るための規則を 4 つ置く。

1. **音声作品が 0 件の出演者は出さない。** §2 の「作品 0 件の声優はページを作らない」と同じ思想
2. **音声作品を持つ出演者が 0 人のアニメはページを作らない (404)。** sitemap にも出さない
3. **対象声優が演じたキャラクターだけを保存する。** 全キャストを保存しない。
   AniList の Hoarding 禁止 (§2) にも整合する
4. **アニメの情報そのものを増やさない。** タイトル・シーズン・カバー画像・役の種別まで

1 と 2 が、キャスト表との決定的な違いを作る。キャスト DB は全員を載せるが、この入口は
**音声作品を出している人しか載せない**。実装時に「ついでに全員出す」をしないこと。

---

## 6. URL と導線

### URL

| パス | 内容 |
|---|---|
| `/anime/{slug}` | 1 作品 |
| `/anime/season/{year}-{season}` | そのシーズンの作品一覧 |

`slug` は `title_romaji` から作る (`Sousou no Frieren` → `sousou-no-frieren`)。
英語対応と URL の両方で使うため。

衝突は声優 slug と同じ方針 (`architecture.md` §2) で、**自動で連番を振らず生成を失敗させ、
人が解決する**。続編が「2nd Season」を含むので、実際の衝突は少ない（推測）。

### 導線

```text
トップ (/)
 ├─ 今期のアニメ  ──→ /anime/season/2026-fall
 └─ 新着フィード (既存)

/anime/season/2026-fall
 └─ 作品カード ──→ /anime/{slug}

/anime/{slug}
 └─ キャラクター + 声優 ──→ /voice-actors/{slug}

/voice-actors/{slug}
 └─ 出演アニメ ──→ /anime/{slug}   (§7-3)
```

`sitemap.xml` に `/anime/{slug}` と `/anime/season/{...}` を追加する。

---

## 7. 画面のイメージ

### シーズン一覧 `/anime/season/2026-fall`

```text
2026 秋アニメ

[cover] 薬屋のひとりごと 第3期
        出演者 7 人に音声作品

[cover] 転生したら剣でした 第2期
        出演者 3 人に音声作品
```

### 作品ページ `/anime/{slug}`

キャラクターを主役にして並べる。ファンが覚えているのはキャラだから。

```text
[cover]  薬屋のひとりごと 第3期
         2026 秋

この作品の出演者で、音声作品を出している人

[char]  猫猫              主演
        悠木碧
        ASMR 12 / 朗読 2

[char]  壬氏              主演
        大塚剛央
        朗読 5

[char]  △△△△           助演
        長谷川育美
        ASMR 5 / ドラマCD 2
```

媒体別の件数は `media-contrast-2026-09-18.md` の提案 1 と同じ見方。
提案 1 を採らない場合は合計件数だけでよい。

### 声優ページへの追加 `/voice-actors/{slug}`

```text
上田麗奈

出演アニメ
[char] 〇〇〇〇 / キャラ名
[char] △△△△ / キャラ名
…
```

---

## 8. 英語対応

データは日英とも保存する。**UI を英語化するかは別の判断**で、データを持っていれば後から出せる。

| 対象 | 日本語 | 英語 |
|---|---|---|
| アニメタイトル | `title_native` | `title_english ?? title_romaji` |
| キャラクター名 | `character_name_native` | `character_name_full` |
| 声優名 | `canonical_name` | `name_en` (新設) |
| 作品タイトル (音声) | ストアの表記 | **無い** |
| UI の文言 | 実装済み | 未実装 |

`architecture.md:88` は「日本語 UI のみ (i18n は入れない)」としている。
**本設計はこれを覆さない。** 英語データを保存するだけで、UI の言語切り替えは含まない。
i18n を入れるかは別に決める。

音声作品のタイトルはストアの日本語表記しか無いので、UI を英語化しても
作品一覧は日本語のままになる。英語化の価値は限定的（推測）。

---

## 9. 未確認事項

| # | 事項 | 影響 |
|---:|---|---|
| 1 | `title.romaji` と `title.english` の全体の欠落率 | slug 生成と英語表示のフォールバック設計。キャッシュの全 media で数えられる |
| 2 | AniList の「competing service」の解釈 | §2。フォロー + 新着通知という構造が tracker に見えるリスク。判断はユーザー |
| 3 | 収益が $150/月 に達する時期 | §2 の商用ライセンス。達する前に問い合わせる |

---

## 10. 実装の順序 (案)

1. AniList の取得項目を増やし、タイトルとキャラクターを残す (`anilist.ts` / `run.ts`)
2. テーブル 2 つ + `voice_actors.name_en` とマイグレーション
3. `anime.generated.json` の生成と取り込み API
4. `/anime/season/{...}` と `/anime/{slug}`
5. 声優ページへの「出演アニメ」追加
6. トップからの導線と sitemap

1 と 2 は独立しているので並行できる。
