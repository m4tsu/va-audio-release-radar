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
import { Button } from "@/app/components/ui/button";
import { useFollowStore } from "@/app/store/follow-store";
import appCss from "@/index.css?url";

/**
 * 配色の初期適用。SSR された HTML を受け取ったブラウザが最初のペイントをする前に
 * html へ .dark を付けるため、head の中でインラインに実行する (後から付けると白→黒のちらつきが出る)。
 * 保存値は localStorage の "theme" ("light" | "dark" | "system")。未設定なら OS の設定に従う
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

const description =
  "好きな声優をフォローすると、複数の音声販売サービスを横断して新しく買える音声作品だけを一か所で追える Web サービス。";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Voice Actor Audio Release Radar" },
      { name: "description", content: description },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
    ],
    scripts: [{ children: themeScript }],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: ErrorScreen,
});

/** <html> から <body> までの外枠。SSR とハイドレーションの両方でここが文書全体になる */
function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja">
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
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootLayout() {
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
            Voice Actor Audio Release Radar
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link
              to="/"
              activeOptions={{ exact: true }}
              activeProps={{ className: "font-medium text-foreground" }}
              inactiveProps={{ className: "text-muted-foreground" }}
              className="hover:text-foreground"
            >
              ホーム
            </Link>
            <Link
              to="/following"
              activeProps={{ className: "font-medium text-foreground" }}
              inactiveProps={{ className: "text-muted-foreground" }}
              className="hover:text-foreground"
            >
              フォロー中
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t bg-card">
        <div className="mx-auto max-w-6xl space-y-1 px-4 py-6 text-muted-foreground text-xs">
          <p>非公式サービス。作品情報は各ストアの公開情報に基づく。</p>
          <p>価格は取得時点のもの。最新の価格と販売状況は各ストアで確認すること。</p>
        </div>
      </footer>
    </div>
  );
}

function NotFound() {
  return (
    <div className="py-10 text-center">
      <h1 className="font-semibold text-2xl tracking-tight">ページが見つかりません</h1>
      <p className="mt-2 text-muted-foreground text-sm">
        URL が変わったか、その声優・作品をまだ収集していない可能性がある。
      </p>
      <Button asChild className="mt-6">
        <Link to="/">トップへ</Link>
      </Button>
    </div>
  );
}

/**
 * 予期しない失敗の受け皿。原因はストア側の仕様変更や D1 の一時的な失敗が多く、
 * 再読み込みで直ることがあるので、まず再試行の手段を出す
 */
function ErrorScreen({ error }: ErrorComponentProps) {
  const router = useRouter();
  const message = error instanceof Error ? error.message : "原因を特定できませんでした。";
  return (
    <div className="py-10 text-center">
      <h1 className="font-semibold text-2xl tracking-tight">表示できませんでした</h1>
      <p className="mt-2 text-muted-foreground text-sm">{message}</p>
      <div className="mt-6 flex justify-center gap-2">
        <Button type="button" onClick={() => void router.invalidate()}>
          再試行
        </Button>
        <Button asChild variant="outline">
          <Link to="/">トップへ</Link>
        </Button>
      </div>
    </div>
  );
}
