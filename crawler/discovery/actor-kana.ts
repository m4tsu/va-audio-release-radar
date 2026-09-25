/**
 * 声優 1 人ぶんのかなの取得結果の形。
 *
 * 取得そのものは `wikipedia-kana.ts`、記事 HTML の解析は `wikipedia-article.ts`、
 * かなの文字列の形は `kana-text.ts`。台帳へ送る側 (`crawler/kana.ts`) はこの型だけを見るので、
 * 送る側の型に取得の依存 (fetch / HTML 解析) が入らない
 */

/**
 * かなをどこから取ったか。
 * furigana=`Template:声優` の引数 / kana-name=名前そのものがかな /
 * lead=記事の導入部の括弧 / wikidata=Wikidata の P1814。
 * 後ろの 2 つは `wikipedia-kana-refill.ts` が、読みの無かった人だけを引き直して埋める
 */
export type ActorKanaSource = "furigana" | "kana-name" | "lead" | "wikidata";

/**
 * 1 人ぶんの結果。取れなかった人も理由付きで残す。
 * 記事が無い・条件を満たさないという答えと、取得の失敗を分けないと、答えの出た人に引いた印を付けられない
 */
export type ActorKanaRecord = {
  canonicalName: string;
  /** ok=かなが取れた / rejected=記事はあるが条件を満たさない / not-found=記事が無い / failed=取得に失敗 */
  status: "ok" | "rejected" | "not-found" | "failed";
  /** 保存する形のかな (空白なしのひらがな) */
  kana?: string;
  /** 記事に書かれていたままの値。取り違えを後から追えるようにする */
  rawKana?: string;
  source?: ActorKanaSource;
  /** かなを取った、または最後に引いた記事名 */
  title?: string;
  /** 着地した記事名。転送されたかどうかが後から分かる */
  pageName?: string;
  /** 引いた Wikidata の項目 id。どの項目から読みを取ったかを後から追えるようにする */
  wikibaseItemId?: string;
  reason?: string;
  /** HTTP ステータス。ネットワークエラーでは undefined */
  httpStatus?: number;
  fetchedAt: string;
};
