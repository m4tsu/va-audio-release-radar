import { desc } from "drizzle-orm";
import type { Inquiry, InquirySubmission } from "@/domain/types";
import { inquiries } from "../db/schema";
import type { AppDb } from "../db/types";

/**
 * 届いた問い合わせの保存と読み出し。
 *
 * 入力の検証はここに持たない。`@/domain/types` の `inquirySubmissionSchema` を通った
 * `InquirySubmission` だけを受け取る形にして、受け付ける経路が増えても検証の場所を 1 つに保つ
 */

/** 1 度に返す上限の既定値。読み手が指定しなくても際限なく読まないための歯止め */
const DEFAULT_LIST_LIMIT = 100;

/**
 * 1 件保存し、採番された行を返す。
 *
 * 受け取った時刻はサーバーが決める。送信者が申告した時刻を信じると、並びを外から操作できる。
 * **`now` は `toISOString()` の形で渡す。** 新しい順の並びは文字列の大小で決まるので、
 * 時差付きの表記 (`+09:00`) が混ざると順序が壊れる
 */
export async function saveInquiry(
  db: AppDb,
  submission: InquirySubmission,
  now: string = new Date().toISOString(),
): Promise<Inquiry> {
  const [row] = await db
    .insert(inquiries)
    .values({
      kind: submission.kind,
      body: submission.body,
      contact: submission.contact ?? null,
      receivedAt: now,
    })
    .returning();

  // insert が 1 行も返さないのは D1 / libsql が書けなかったときだけ。黙って握らずに落とす
  if (!row) throw new Error("問い合わせを保存できなかった");
  return toInquiry(row);
}

/**
 * 新しい順に読む。同じ時刻の行は後から入った方 (id が大きい方) を先に出す。
 * 受け取った時刻の精度はミリ秒なので、同時に届いた 2 件の並びが実行ごとに入れ替わらないようにする
 */
export async function listInquiries(db: AppDb, limit = DEFAULT_LIST_LIMIT): Promise<Inquiry[]> {
  const rows = await db
    .select()
    .from(inquiries)
    .orderBy(desc(inquiries.receivedAt), desc(inquiries.id))
    .limit(limit);

  return rows.map(toInquiry);
}

function toInquiry(row: typeof inquiries.$inferSelect): Inquiry {
  return {
    id: row.id,
    kind: row.kind,
    body: row.body,
    // NULL は「未記入」。空文字に丸めると、読み手が未記入かどうかを見分けられなくなる
    ...(row.contact === null ? {} : { contact: row.contact }),
    receivedAt: row.receivedAt,
  };
}
