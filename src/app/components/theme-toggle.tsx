import { Moon, Sun } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { useTheme } from "@/app/hooks/use-theme";
import { useT } from "@/app/i18n";

/**
 * 配色の切り替え。今の見え方のアイコンを出し、押すと反対に固定する 2 択のトグル。
 *
 * 初回は "system" (OS の設定に追従) で、そのままなら OS が変わっても追従し続ける。
 * "system" へ戻す操作はここには出さない。ヘッダーのボタン 1 つで 3 状態を回すと、
 * 押した先が読めず、今どれなのかも分かりにくかった (ユーザーからの指摘)。
 *
 * アイコンは JS の状態ではなく CSS (`dark:` バリアント) で出し分ける。配色そのものは
 * `__root.tsx` のインラインスクリプトが最初の描画前に付けているので、これならハイドレーションを
 * 待たずに正しい方が出る。状態から描くと、ダークのとき一瞬だけ太陽が見えてから月に入れ替わる
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useT();
  const { resolved, setTheme } = useTheme();

  // 読み上げのラベルだけは CSS で出し分けられないので、確定するまでは動作だけを言う
  const label =
    resolved === null
      ? t("theme.labelPending")
      : resolved === "dark"
        ? t("theme.switchToLight")
        : t("theme.switchToDark");

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      className={className}
      title={label}
      aria-label={label}
      // 押されている = ダーク。確定前はどちらとも言えないので属性ごと出さない
      aria-pressed={resolved === null ? undefined : resolved === "dark"}
      data-resolved={resolved ?? undefined}
      // 未確定のうちは押させない。null のまま押すと、どちらへ切り替えるのか決まらない
      disabled={resolved === null}
      onClick={() => {
        if (resolved !== null) setTheme(resolved === "dark" ? "light" : "dark");
      }}
    >
      <Sun aria-hidden="true" className="dark:hidden" />
      <Moon aria-hidden="true" className="hidden dark:block" />
    </Button>
  );
}
