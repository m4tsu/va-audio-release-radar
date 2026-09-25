import {
  createRootRoute,
  type ErrorComponentProps,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppShell, ErrorScreen, NotFoundScreen } from "@/app/components/app-shell";
import { THEME_INIT_SCRIPT } from "@/app/hooks/use-theme";
import { createTranslator, LocaleContext } from "@/app/i18n";
import { webAnalyticsScripts } from "@/app/lib/usage-events";
import { fetchWebAnalyticsToken } from "@/app/server-fns/analytics";
import { resolveLocaleForRoute } from "@/app/server-fns/locale";
import appCss from "@/index.css?url";

export const Route = createRootRoute({
  /**
   * 表示言語を SSR で確定させ、全ルートの context に流す。
   *
   * loader ではなく beforeLoad に置くのは、`head()` から `match.context` として読めるのが
   * ここで返した値だけだからで、子ルートの `head()` でも title を言語に追従させるのに要る
   */
  beforeLoad: async () => ({ locale: await resolveLocaleForRoute() }),
  // 計測のトークンは設定 (`vars.WEB_ANALYTICS_TOKEN`) で、デプロイの間は変わらない。
  // SSR で取った値がハイドレーションに引き継がれるので、画面遷移のたびに取り直さない
  loader: async () => ({ webAnalyticsToken: await fetchWebAnalyticsToken() }),
  staleTime: Number.POSITIVE_INFINITY,
  head: ({ match, loaderData }) => {
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
        // ホーム画面に追加したときの名前とアイコン。iOS は Web Push をホーム画面のアプリにしか届けない。
        // マニフェストは言語 cookie で中身が変わる。既定の取得は cookie を付けないので、付けさせる
        { rel: "manifest", href: "/manifest.webmanifest", crossOrigin: "use-credentials" },
        { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
        { rel: "stylesheet", href: appCss },
      ],
      scripts: [
        { children: THEME_INIT_SCRIPT },
        ...webAnalyticsScripts(loaderData?.webAnalyticsToken ?? null),
      ],
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
