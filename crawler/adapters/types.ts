import type { RawWork, StoreSlug } from "../../src/domain/index.ts";

/**
 * ストアごとの取得アダプタ。
 *
 * ネットワーク取得 (`fetchByActor`) と HTML 解析 (`parseSearchHtml`) を分ける。
 * 解析側は文字列を受け取って値を返すだけの純粋関数にしてあるので、
 * `crawler/fixtures/` の固定 HTML に対してネットワーク無しでテストできる
 */
export interface SourceAdapter {
  readonly storeSlug: StoreSlug;
  fetchByActor(actor: ActorQuery, options?: FetchByActorOptions): Promise<AdapterResult>;
  /**
   * 検索結果 1 ページ目の HTML を解析する。
   * @param fetchedAt RawWork.fetchedAt に入れる ISO 8601 文字列 (呼び出し側が決める)
   */
  parseSearchHtml(html: string, fetchedAt: string): ParsedWorks;
  /**
   * ストアの新着一覧から、まだ知らない作品だけを取る (日次の走行。`decisions/0007`)。
   * 声優を指定しないので、誰の作品かは取り込み側が出演者名で照合する。
   *
   * 任意にしてあるのは、新着一覧を使えるかがストアごとに違うため。
   * 持たないストアは日次の対象から外れ、月次の声優起点だけで拾う
   */
  fetchNewReleases?(options?: FetchNewReleasesOptions): Promise<FeedResult>;
}

export type FetchNewReleasesOptions = {
  /**
   * 既に DB にある storeProductId。**新着一覧の走行では詳細を取らないだけでなく、
   * 送りもしない。** 日次の目的は新作の検出で、既知の作品の項目を直すのは月次の役目
   */
  knownIds?: ReadonlySet<string>;
  /** false で .cache/snapshots への保存を止める (--no-snapshot) */
  snapshot?: boolean;
};

/** 新着一覧 1 回ぶんの結果。声優を指定しないので `AdapterResult` と違って actorName を持たない */
export type FeedResult = ParsedWorks & {
  storeSlug: StoreSlug;
  status: AdapterStatus;
  /** `empty` / `error` の理由。人が読む 1 行 */
  reason?: string;
  /**
   * 新着一覧に出た作品の数。`works` との差は、既知なので送らなかった数と、
   * ストアごとの理由で落とした数 (許可していない年齢区分、出演者が分からない) の合計。
   * 内訳は警告にしか出ない
   */
  listedCount: number;
  /**
   * 引くつもりだった一覧をすべて取れたか。false なら見に行けなかった入口がある。
   * 「新作を取りこぼしていないか」ではない (新着一覧は総件数を出さないので、それは分からない)
   */
  complete: boolean;
  /** 実際に取れた一覧ページ数。DLsite は引くフロアの数 (`Coverage.pages` と同じ数え方) */
  pages: number;
};

/**
 * `fetchByActor` に渡す検索対象。
 *
 * Audible は名前によって空白の有無で検索結果が変わる (例: 「石見舞菜香」は 302、
 * 「石見 舞菜香」は 2 件) ため、試す順序付きの候補を `searchNames` として渡す。
 * DLsite は表記揺れの影響を受けないので `canonicalName` の完全一致検索だけを使い、
 * `searchNames` は無視する。
 *
 * ポケドラは名前で検索しない。声優がタグ (`tag_id`) という一級の概念になっていて、
 * 事前に作った辞書から ID を引くほうが表記揺れに強いため、`storeActorRefs` を見る
 */
export type ActorQuery = {
  canonicalName: string;
  searchNames: string[];
  /**
   * ストア固有の声優 ID。ポケドラのタグ辞書のように、引く前から ID が分かっている
   * ストアだけに入る。同じ人に ID が 2 つ付いていることがある (ポケドラで 7 組) ので配列で持つ
   */
  storeActorRefs?: Readonly<Partial<Record<StoreSlug, readonly StoreActorRef[]>>>;
};

/** 辞書から渡すストア固有の声優 ID 1 件 */
export type StoreActorRef = {
  externalId: string;
  /**
   * ストア区分ごとの既知の作品数 (ポケドラの `men` / `bl` など)。
   * 0 件と分かっている区分のページは引かずに済ませるために渡す。
   * 分からないときは undefined にして、adapter に全区分を引かせる
   */
  counts?: Readonly<Record<string, number>>;
};

/**
 * 取得中に実際に見えた (ストア固有の声優 ID, そのときの表記) の組。
 *
 * ポケドラの `tag_id` は「同じ tag_id なら同一人物」というストア由来の事実なので、
 * 別名義や表記揺れの根拠に使える。名前しか出さない DLsite / Audible では空
 */
export type ObservedActorRef = { externalId: string; name: string };

export type ParsedWorks = {
  works: RawWork[];
  /** rawWorkSchema の検証に落ちて捨てた件数 (健全性チェック用) */
  invalidCount: number;
  /** 人が読む警告。捨てた理由や欠けた項目 */
  warnings: string[];
  /**
   * 検索結果の総件数 (ストアが出している場合のみ)。DLsite は埋め込み JSON の `pager.count`、
   * Audible は「検索結果 N のうち」の表示から取る。どちらも 1 ページ目しか取れないので、
   * これが実取得件数を上回っていれば取りこぼしがあると分かる (管理画面向け)
   */
  totalCount?: number;
};

/**
 * 1 回の取得の結果。
 *
 * - `ok`: 取得できた (works が 0 件のこともある)
 * - `empty`: 取得はできたが「該当なし」だと分かった。失敗ではないので crawl_runs は status=ok・
 *   0 件で記録する。Audible の `/no-search-results` への 302 がこれにあたる
 * - `error`: 取得自体に失敗した。works は空で、既存の listing / credit は消さない
 *
 * `empty` を `error` と混ぜないのは、管理画面で「クローラーが壊れた」と「作品が無い」を
 * 見分けられるようにするため
 */
export type AdapterStatus = "ok" | "empty" | "error";

/**
 * 網羅率。どちらのストアも検索の 1 ページ目しか取れないので、
 * 「その声優の作品を取りこぼしていないか」を数字で残せるようにする。
 *
 * `total` はストアが出す総件数 (DLsite の `pager.count` / Audible の「検索結果 N のうち」)。
 * 表示が無い検索では取れないので undefined になる。そのとき `complete` はふつう undefined で、
 * 総件数を知らないまま「全部取れた」とは記録しない。取りこぼしを見逃す方向に嘘をつくため。
 * 例外は下の `complete` に書いた「総件数抜きでも取りこぼしが確かな」場合だけ
 */
export type Coverage = {
  /** 検索一覧から集めた作品数 (並び順違いの和集合。重複は除く) */
  fetched: number;
  /** ストアが表示する総件数。取れなければ undefined */
  total?: number;
  /**
   * 総件数ぶんを取り切れたか。ふつうは `total` を取れたときだけ true / false になる。
   * 例外は「取り切れていないことが総件数抜きで分かる」場合で、DLsite がフロアを 1 つ
   * 取りこぼしたときは `total` を落としたまま false を入れる (`adapters/dlsite.ts`)。
   * false で総件数が無い記録は「見に行けなかった範囲がある」を意味する。
   * 逆に true は総件数と突き合わせたときにしか入らない
   */
  complete?: boolean;
  /**
   * `fetched` のうち、検索した声優本人がクレジットされていた件数。
   *
   * Audible の `searchNarrator=` は完全一致ではなく、姓だけ一致する別人の作品も返す
   * (「佐藤 元」で引くと佐藤恵・佐藤弘樹などが並び、本人は 1 件も含まれない)。
   * `fetched` との比が低いときは `total` がその声優の作品数ではないので、
   * adapter は `total` と `complete` を落として「不明」にする。その判断根拠をここに残す。
   * 名前で検索しないストア (ポケドラ) や完全一致検索のストア (DLsite) では undefined
   */
  matched?: number;
  /**
   * 実際に取れた検索ページ数。相手サイトへの往復が増えていないことを
   * CLI とログから確かめられるようにするため。
   *
   * 1 声優あたりの最小値はストアによって違う。検索の入口が 1 つのストアは 1 だが、
   * DLsite は引くフロアの数、ポケドラは引く区分の数から始まる。
   * 取れなかったページは数えないので、警告と突き合わせないと空振りの回数は分からない
   */
  pages: number;
};

export type AdapterResult = ParsedWorks & {
  storeSlug: StoreSlug;
  actorName: string;
  status: AdapterStatus;
  /** `empty` / `error` の理由。人が読む 1 行 */
  reason?: string;
  /** 実際に検索に使った語。Audible は候補を順に試すので、確定した語をここに残す */
  queryUsed?: string;
  /** 網羅率。検索そのものに失敗した (`error`) ときは undefined */
  coverage?: Coverage;
  /** 取得中に見えたストア固有の声優 ID。今はポケドラだけが返す */
  observedActorRefs?: ObservedActorRef[];
};

export type FetchByActorOptions = {
  /** 詳細取得を飛ばす既知の storeProductId。将来 DB から渡す (--skip-known) */
  skipKnownIds?: ReadonlySet<string>;
  /** false で .cache/snapshots への保存を止める (--no-snapshot) */
  snapshot?: boolean;
};
