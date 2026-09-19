import {
  createRootRoute,
  type ErrorComponentProps,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useRouter,
} from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { LocaleSelect } from "@/app/components/locale-select";
import { ThemeToggle } from "@/app/components/theme-toggle";
import { Button } from "@/app/components/ui/button";
import { createTranslator, LocaleContext, useT } from "@/app/i18n";
import { resolveLocaleForRoute } from "@/app/server-fns/locale";
import { useFollowStore } from "@/app/store/follow-store";
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
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: ErrorScreen,
});

/**
 * <html> から <body> までの外枠。SSR とハイドレーションの両方でここが文書全体になる。
 *
 * 言語の Provider をここに置くのは、エラー画面と notFound がルートの component の外側
 * (この shellComponent の内側) で描かれるため。RootLayout に置くと、その 2 つだけ
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

function RootLayout() {
  const t = useT();
  const init = useFollowStore((state) => state.init);

  // フォローはブラウザ内 (IndexedDB) にしか無い。SSR では読めないので、
  // マウント後にここで 1 回だけ読み込む。init 自体が多重実行を防ぐ
  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link to="/" className="font-semibold tracking-tight">
            {t("app.name")}
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link
              to="/"
              activeOptions={{ exact: true }}
              activeProps={{ className: "font-medium text-foreground" }}
              inactiveProps={{ className: "text-muted-foreground" }}
              className="hover:text-foreground"
            >
              {t("nav.home")}
            </Link>
            <Link
              to="/voice-actors"
              activeProps={{ className: "font-medium text-foreground" }}
              inactiveProps={{ className: "text-muted-foreground" }}
              className="hover:text-foreground"
            >
              {t("nav.voiceActors")}
            </Link>
            <Link
              to="/anime"
              activeProps={{ className: "font-medium text-foreground" }}
              inactiveProps={{ className: "text-muted-foreground" }}
              className="hover:text-foreground"
            >
              {t("nav.anime")}
            </Link>
            <Link
              to="/following"
              activeProps={{ className: "font-medium text-foreground" }}
              inactiveProps={{ className: "text-muted-foreground" }}
              className="hover:text-foreground"
            >
              {t("nav.following")}
            </Link>
          </nav>
          {/* 表示の設定は右端にまとめる。読み物そのものではないので導線から離す */}
          <div className="ml-auto flex items-center gap-2">
            <LocaleSelect />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t bg-card">
        <div className="mx-auto max-w-6xl space-y-1 px-4 py-6 text-muted-foreground text-xs">
          <p>{t("footer.unofficial")}</p>
          <p>{t("footer.price")}</p>
          <nav className="flex gap-4 pt-2">
            <Link to="/terms" className="underline-offset-2 hover:underline">
              {t("footer.terms")}
            </Link>
            <Link to="/privacy" className="underline-offset-2 hover:underline">
              {t("footer.privacy")}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function NotFound() {
  const t = useT();
  return (
    <div className="py-10 text-center">
      <h1 className="font-semibold text-2xl tracking-tight">{t("notFound.title")}</h1>
      <p className="mt-2 text-muted-foreground text-sm">{t("notFound.description")}</p>
      <Button asChild className="mt-6">
        <Link to="/">{t("notFound.toTop")}</Link>
      </Button>
    </div>
  );
}

/**
 * 予期しない失敗の受け皿。原因はストア側の仕様変更や D1 の一時的な失敗が多く、
 * 再読み込みで直ることがあるので、まず再試行の手段を出す
 */
function ErrorScreen({ error }: ErrorComponentProps) {
  const t = useT();
  const router = useRouter();
  // 例外のメッセージは英語のことも日本語のこともある。訳さずそのまま出す
  const message = error instanceof Error ? error.message : t("errorScreen.unknownCause");
  return (
    <div className="py-10 text-center">
      <h1 className="font-semibold text-2xl tracking-tight">{t("errorScreen.title")}</h1>
      <p className="mt-2 text-muted-foreground text-sm">{message}</p>
      <div className="mt-6 flex justify-center gap-2">
        <Button type="button" onClick={() => void router.invalidate()}>
          {t("errorScreen.retry")}
        </Button>
        <Button asChild variant="outline">
          <Link to="/">{t("errorScreen.toTop")}</Link>
        </Button>
      </div>
    </div>
  );
}
