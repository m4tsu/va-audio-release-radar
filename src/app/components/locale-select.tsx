import { Languages } from "lucide-react";
import { useId } from "react";
import { isLocale, LOCALES, useLocale, useT } from "@/app/i18n";
import { writeLocaleCookie } from "@/app/server-fns/locale";

const NAME_KEYS = { ja: "locale.ja", en: "locale.en" } as const;

/**
 * 表示言語の切り替え。
 *
 * 選んだら cookie に書いてページを丸ごと読み込み直す。言語は SSR で解決していて、
 * meta や `<html lang>` まで言語に追従させているので、クライアントだけ差し替えると
 * 画面の中と文書の頭で言語が食い違う。ちらつきより一貫性を採る (設計の決定)
 */
export function LocaleSelect({ className }: { className?: string }) {
  const t = useT();
  const locale = useLocale();
  const selectId = useId();

  return (
    <div className={className}>
      <label htmlFor={selectId} className="sr-only">
        {t("locale.label")}
      </label>
      <div className="relative">
        <Languages
          aria-hidden="true"
          className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 size-4 text-muted-foreground"
        />
        <select
          id={selectId}
          value={locale}
          onChange={(event) => {
            const next = event.target.value;
            if (!isLocale(next) || next === locale) return;
            writeLocaleCookie(next);
            // cookie を読み直させる。history を増やさないよう reload で戻す
            window.location.reload();
          }}
          className="h-8 rounded-md border border-input bg-transparent py-0 pr-2 pl-7 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {LOCALES.map((value) => (
            <option key={value} value={value}>
              {t(NAME_KEYS[value])}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
