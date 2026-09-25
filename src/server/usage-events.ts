import { type UsageEvent, usageEventSchema } from "@/contract";

/**
 * 画面から届く操作を Workers Analytics Engine に 1 件ずつ書く (`POST /api/event`)。
 * 数える操作と、それが指標のどちらの分子かは `usageEventSchema` (`@/contract`)。
 * 分母のページビューは Cloudflare Web Analytics が数える。決定は
 * `docs/decisions/0016-count-actions-in-analytics-engine.md`
 *
 * 書く列は blob1 = 操作の種類、blob2 = ストア (ストアを持たない操作は空文字)。
 * IP アドレスや User-Agent は書かない。1 件がどのブラウザから来たかを後から辿れないようにするため
 */

/**
 * 計測を有効にする印を兼ねる Web Analytics のトークン。空なら計測しない
 * (ページビューも操作も数えない。dev・E2E・公開前の操作が数字に混ざらないように、両方を 1 つの設定で止める)
 */
export function webAnalyticsToken(value: string | undefined): string | null {
  const token = value?.trim() ?? "";
  return token.length > 0 ? token : null;
}

/** 本文の上限 (バイト)。受け付ける本文はどれも数十バイトで、これを超えるものは読み切らずに捨てる */
const MAX_BODY_LENGTH = 256;

export function usageEventDataPoint(event: UsageEvent): AnalyticsEngineDataPoint {
  return {
    blobs: [event.type, event.type === "store_click" ? event.store : ""],
    // 標本化の単位。種類ごとに分けておくと、多い操作が少ない操作の標本を押し出さない
    indexes: [event.type],
  };
}

/**
 * 受け取った本文を検証して書く。計測が無効なときは検証もせず 204 を返す
 * (無効かどうかを外から見分けさせる理由が無い)
 */
export async function handleUsageEvent(
  request: Request,
  sink: { enabled: boolean; dataset: AnalyticsEngineDataset | undefined },
): Promise<Response> {
  if (!sink.enabled || !sink.dataset) return new Response(null, { status: 204 });

  const text = await readLimited(request, MAX_BODY_LENGTH);
  if (text === null) return new Response(null, { status: 400 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const parsed = usageEventSchema.safeParse(body);
  if (!parsed.success) return new Response(null, { status: 400 });

  sink.dataset.writeDataPoint(usageEventDataPoint(parsed.data));
  return new Response(null, { status: 204 });
}

/**
 * 本文を上限まで読む。超えたら null。経路に認可が無いので、巨大な本文を丸ごと
 * メモリに載せてから長さを見ると、それだけで Worker の上限に届く
 */
async function readLimited(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
