import type { z } from "zod";

/**
 * zod の検証結果を API の応答に載せる形に畳む。
 * issue をそのまま返すと入れ子が深くて読みにくく、内部構造も晒すことになるため、
 * 場所と理由だけにする。件数も打ち切る (1 件の payload に何百作品も入りうるため)
 */
export function summarizeIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.slice(0, 20).map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
