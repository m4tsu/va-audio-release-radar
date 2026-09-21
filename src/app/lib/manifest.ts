import { createTranslator, type Locale } from "@/app/i18n";

/**
 * Web アプリマニフェストの中身。
 *
 * ホーム画面に追加したときの名前とアイコンを決める。iOS Safari は Web Push をホーム画面に
 * 追加したサイトにしか届けないので、通知の前提としてマニフェストが要る。
 * `start_url` をフォロー一覧にしてあるのは、ホーム画面から開く人が見に来るのはそこだから。
 *
 * 表示言語ごとに組むのは説明文のため。名前は言語で変えないブランドなので同じ値になる
 */
export function webManifest(locale: Locale) {
  const t = createTranslator(locale);
  return {
    name: t("app.name"),
    short_name: t("app.name"),
    description: t("app.description"),
    lang: locale,
    start_url: "/following",
    scope: "/",
    display: "standalone",
    // __root.tsx の theme-color (ライト) と favicon.svg の地の色に揃える
    background_color: "#ffffff",
    theme_color: "#111111",
    // 生成は scripts/generate-icons.mjs
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
