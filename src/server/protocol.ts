import { INGEST_PROTOCOL_VERSION, readProtocolVersion } from "@/domain/types";

/**
 * クローラーとサーバーの payload 形式が揃っているかの検査。
 *
 * `auth.ts` と同じく `cloudflare:workers` に依存させない。単体テストから
 * 素の値で呼べるようにするため。
 *
 * これが要るのは、クローラーが数時間走る一方でサーバーはその間に差し替わりうるため。
 * 古い形のペイロードを黙って拒否すると、走行中のクローラーの取得結果がすべて捨てられる。
 */

/**
 * 版が揃っていなければ返すべき Response を、揃っていれば null を返す。
 *
 * 400 (payload が不正) ではなく 409 にするのは、クローラー側の対応を変えたいため。
 * 400 はその 1 件だけを捨てて次の声優に進む価値があるが、409 は残り全部も
 * 同じように失敗すると分かっているので、その場で走行ごと止めるのが正しい。
 *
 * `ingestPayloadSchema` に通す前に呼ぶ。版が上がる変更はたいてい `works` の形を
 * 変えるので、先に全体を検証すると「版がずれている」ではなく「works が不正」という
 * 的外れな 400 になり、原因が読み取れない
 */
export function requireIngestProtocolVersion(
  body: unknown,
  expected: number = INGEST_PROTOCOL_VERSION,
): Response | null {
  const received = readProtocolVersion(body);
  if (received === expected) return null;
  return Response.json(
    {
      // 運用者がログでそのまま読む 1 行。「何をすればいいか」まで書く
      error:
        `クローラーが古い。取り込みを中断して再起動する必要がある ` +
        `(クローラー: ${received ?? "未指定"} / サーバー: ${expected})`,
      expectedProtocolVersion: expected,
      receivedProtocolVersion: received ?? null,
    },
    { status: 409 },
  );
}
