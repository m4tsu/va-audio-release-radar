import { type RawWork, rawWorkSchema } from "../../src/domain/index.ts";
import type { ParsedWorks } from "./types.ts";

/**
 * adapter が組み立てた候補を `rawWorkSchema` で検証する。
 * 検証に落ちたものは例外にせず捨てる。1 作品の崩れで 30 件まるごと失うほうが痛いため。
 * 捨てた件数は呼び出し側に返し、CLI と ingest が異常に気づけるようにする
 */
export function validateRawWorks(candidates: readonly unknown[]): ParsedWorks {
  const works: RawWork[] = [];
  const warnings: string[] = [];
  let invalidCount = 0;

  for (const candidate of candidates) {
    const parsed = rawWorkSchema.safeParse(candidate);
    if (parsed.success) {
      works.push(parsed.data);
      continue;
    }
    invalidCount += 1;
    warnings.push(
      `検証に失敗したため除外: ${describeCandidate(candidate)} — ${issueSummary(parsed.error.issues)}`,
    );
  }

  return { works, invalidCount, warnings };
}

/** 検証に落ちた候補を 1 行で識別できるようにする。id が無いこともあるので緩く読む */
function describeCandidate(candidate: unknown): string {
  if (typeof candidate !== "object" || candidate === null) return String(candidate);
  const record = candidate as Record<string, unknown>;
  const id = typeof record.storeProductId === "string" ? record.storeProductId : "(id 不明)";
  const title = typeof record.titleRaw === "string" ? record.titleRaw : "(タイトル不明)";
  return `${id} ${title}`;
}

function issueSummary(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join(", ");
}
