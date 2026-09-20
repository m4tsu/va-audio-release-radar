import {
  createRootRoute,
  type ErrorComponentProps,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppShell, ErrorScreen, NotFoundScreen } from "@/app/components/app-shell";
import { createTranslator, LocaleContext } from "@/app/i18n";
import { resolveLocaleForRoute } from "@/app/server-fns/locale";
import appCss from "@/index.css?url";

/**
 * 配色の初期適用。SSR された HTML を受け取ったブラウザが最初のペイントをする前に
 * html へ .dark を付けるため、head の中でインラインに実行する (後から付けると白→黒のちらつきが出る)。
 * 保存値は localStorage の "theme" ("light" | "dark" | "system")。未設定なら OS の設定に従う。
 * キーと値の形は `hooks/use-theme.ts` と揃えること
 */
const themeScript = `(function () {
  try {
    var theme = localStorage.getItem("theme") || "system";
    var isDark =
      theme === "dark" ||
      (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (isDark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();`;

export const Route = createRootRoute({
  /**
   * 表示言語を SSR で確定させ、全ルートの context に流す。
   *
   * loader ではなく beforeLoad に置くのは、`head()` から `match.context` として読めるのが
   * ここで返した値だけだからで、子ルートの `head()` でも title を言語に追従させるのに要る
   */
  beforeLoad: async () => ({ locale: await resolveLocaleForRoute() }),
  head: ({ match }) => {
    const t = createTranslator(match.context.locale);
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: t("app.name") },
        { name: "description", content: t("app.description") },
      ],
      links: [
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "stylesheet", href: appCss },
      ],
      scripts: [{ children: themeScript }],
    };
  },
  shellComponent: RootDocument,
  component: AppShell,
  notFoundComponent: NotFoundScreen,
  errorComponent: RouteErrorComponent,
});

/**
 * <html> から <body> までの外枠。SSR とハイドレーションの両方でここが文書全体になる。
 *
 * 言語の Provider をここに置くのは、エラー画面と notFound がルートの component の外側
 * (この shellComponent の内側) で描かれるため。AppShell に置くと、その 2 つだけ
 * 既定の日本語に落ちる
 */
function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  const { locale } = Route.useRouteContext();

  /**
   * `suppressHydrationWarning` は head のインラインスクリプトのため。
   * あれがハイドレーションより前にこの要素へ .dark を付けるので、配色を知らないサーバーの
   * 出力と class が必ず食い違い、React が警告を出す。この属性が黙らせるのは自分自身の
   * 属性とテキストの差分だけで、子要素の不一致はそのまま警告される
   */
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/*
          theme-color は light / dark を media で出し分ける。HeadContent 経由の meta は
          name が同じものを 1 つに畳んでしまうため、ルートで変わらないこの 2 つは直接書く
        */}
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#111111" />
        <HeadContent />
      </head>
      <body>
        <LocaleContext value={locale}>{children}</LocaleContext>
        <Scripts />
      </body>
    </html>
  );
}

/** ルーターが渡すエラーの形を、画面が扱う形に落とす */
function RouteErrorComponent({ error }: ErrorComponentProps) {
  return <ErrorScreen error={error} />;
}
