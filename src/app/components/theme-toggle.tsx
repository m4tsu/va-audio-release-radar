import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { nextThemePreference, type ThemePreference, useTheme } from "@/app/hooks/use-theme";
import { type TKey, useT } from "@/app/i18n";

/** 3 状態それぞれのアイコン。"system" は「OS の画面に合わせる」ので画面の絵にする */
const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

const NAME_KEYS = {
  light: "theme.light",
  dark: "theme.dark",
  system: "theme.system",
} as const satisfies Record<ThemePreference, TKey>;

/**
 * 配色の切り替え。押すたびに ライト → ダーク → OS に合わせる と回る。
 *
 * ボタン 1 つで 3 状態を回すのは、ヘッダーに置く部品として幅を取らないため。
 * 今どれなのかはアイコンと読み上げラベルの両方に出す。
 *
 * マウントが済むまで (`theme === null`) は状態を確定させない。SSR では localStorage も
 * OS の設定も読めず、そこで「ライト」などと決め打つとハイドレーションで食い違う。
 * 画面に出ている配色そのものは `__root.tsx` のインラインスクリプトが既に付けている
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useT();
  const { theme, setTheme } = useTheme();

  const next = theme === null ? null : nextThemePreference(theme);
  const Icon = theme === null ? Monitor : ICONS[theme];
  const label =
    theme === null || next === null
      ? t("theme.labelPending")
      : t("theme.label", { current: t(NAME_KEYS[theme]), next: t(NAME_KEYS[next]) });

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      className={className}
      title={label}
      aria-label={label}
      // 未確定のうちは押させない。null のまま押すと、どの状態から回すのか決まらない
      disabled={next === null}
      onClick={() => {
        if (next !== null) setTheme(next);
      }}
    >
      <Icon aria-hidden="true" />
    </Button>
  );
}
