import { Globe } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { isLocale, LOCALES, useLocale, useT } from "@/app/i18n";
import { writeLocaleCookie } from "@/app/server-fns/locale";

const NAME_KEYS = { ja: "locale.ja", en: "locale.en" } as const;

/**
 * 表示言語の切り替え。
 *
 * 選んだら cookie に書いてページを丸ごと読み込み直す。言語は SSR で解決していて、
 * meta や `<html lang>` まで言語に追従させているので、クライアントだけ差し替えると
 * 画面の中と文書の頭で言語が食い違う。ちらつきより一貫性を採る (設計の決定)。
 *
 * ネイティブの `<select>` は使わない。選択肢の描画を OS に任せることになり、
 * ダークのときに白背景・白文字で読めなくなる。Radix の Select なら選択肢も
 * `--popover` 系のトークンで描くので、どちらの配色でも同じ見た目になる (設計の決定)
 */
export function LocaleSelect({ className }: { className?: string }) {
  const t = useT();
  const locale = useLocale();

  return (
    <Select
      value={locale}
      onValueChange={(next) => {
        if (!isLocale(next) || next === locale) return;
        writeLocaleCookie(next);
        // cookie を読み直させる。history を増やさないよう reload で戻す
        window.location.reload();
      }}
    >
      {/*
        地球儀は「言語の設定」という役割を示すだけ。今どの言語かは右の文字が言う。
        aria-label は要素の中身より優先されて名前を上書きするので、今の言語名も畳み込む
      */}
      <SelectTrigger
        size="sm"
        className={className}
        aria-label={t("locale.label", { name: t(NAME_KEYS[locale]) })}
      >
        <Globe aria-hidden="true" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LOCALES.map((value) => (
          <SelectItem key={value} value={value}>
            {t(NAME_KEYS[value])}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
