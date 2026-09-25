/** `parseArgs` の値のうち文字列だけを取る。真偽値のフラグとして渡されたものは指定なしとみなす */
export function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
