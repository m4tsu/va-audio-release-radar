import { ArrowUpDown } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { type PlainTKey, useT } from "@/app/i18n";

/**
 * 一覧の並べ替え。声優一覧とアニメの一覧が使う。
 *
 * 画面には選ばれている方しか出ないので、読み上げ名に役割と今の値の両方を畳み込む。
 * ネイティブの `<select>` を使わない理由は `locale-select.tsx` と同じ
 */
export function SortSelect<T extends string>({
  value,
  options,
  labelKeys,
  isOption,
  onChange,
}: {
  value: T;
  options: readonly T[];
  /** 選択肢ごとの文言。`options` の各値に 1 つずつ要る */
  labelKeys: Record<T, PlainTKey>;
  /** Radix は文字列で返すので、受け取ってよい値かを呼び出し側の型で確かめる */
  isOption: (candidate: string) => candidate is T;
  onChange: (next: T) => void;
}) {
  const t = useT();
  // 総称の添字アクセス (`labelKeys[value]`) のままでは、埋め込みの無いキーだと型で示せない
  const label = (option: T): string => {
    const key: PlainTKey = labelKeys[option];
    return t(key);
  };

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (isOption(next)) onChange(next);
      }}
    >
      <SelectTrigger size="sm" aria-label={t("common.sortLabel", { name: label(value) })}>
        <ArrowUpDown aria-hidden="true" />
        {/* Radix は選ばれた項目の文言を SelectItem から流し込む。開くまで項目が描かれず
            SSR では空のまま返るので、文言をここで直接渡す */}
        <SelectValue>{label(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {label(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
