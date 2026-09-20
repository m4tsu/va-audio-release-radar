import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * 一時ファイルに書いてから rename する。数時間のバッチの途中で中断されても
 * JSON が壊れていないことを保証するため (壊れると再開できず全部やり直しになる)
 */
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}
