import type { RawWork, StoreSlug } from "../../src/domain/index.ts";

/**
 * ストアごとの取得アダプタ (設計書 §19 / §2)。
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
}

/**
 * `fetchByActor` に渡す検索対象 (T8)。
 *
 * Audible は名前によって空白の有無で検索結果が変わる (例: 「石見舞菜香」は 302、
 * 「石見 舞菜香」は 2 件) ため、試す順序付きの候補を `searchNames` として渡す。
 * DLsite は表記揺れの影響を受けないので `canonicalName` の完全一致検索だけを使い、
 * `searchNames` は無視する
 */
export type ActorQuery = {
  canonicalName: string;
  searchNames: string[];
};

export type ParsedWorks = {
  works: RawWork[];
  /** rawWorkSchema の検証に落ちて捨てた件数 (企画書 §21 の健全性チェック用) */
  invalidCount: number;
  /** 人が読む警告。捨てた理由や欠けた項目 */
  warnings: string[];
};

/**
 * 1 回の取得の結果 (設計書 §3)。
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

export type AdapterResult = ParsedWorks & {
  storeSlug: StoreSlug;
  actorName: string;
  status: AdapterStatus;
  /** `empty` / `error` の理由。人が読む 1 行 */
  reason?: string;
  /** 実際に検索に使った語 (T8)。Audible は候補を順に試すので、確定した語をここに残す */
  queryUsed?: string;
};

export type FetchByActorOptions = {
  /** 詳細取得を飛ばす既知の storeProductId。将来 DB から渡す (--skip-known) */
  skipKnownIds?: ReadonlySet<string>;
  /** false で .cache/snapshots への保存を止める (--no-snapshot) */
  snapshot?: boolean;
};
