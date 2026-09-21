import { Link, Outlet, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { LocaleSelect } from "@/app/components/locale-select";
import { ThemeToggle } from "@/app/components/theme-toggle";
import { Button } from "@/app/components/ui/button";
import { useT } from "@/app/i18n";
import { useFollowStore } from "@/app/store/follow-store";

/**
 * 全ページの外枠。ヘッダーの導線、フッターの注記と法務リンク、そして中身の差し込み口。
 * `<html>` から `<body>` までは `src/app/routes/__root.tsx` が持つ
 */
export function AppShell() {
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
          <p>{t("footer.disclaimer")}</p>
          <nav className="flex gap-4 pt-2">
            <Link to="/terms" className="underline-offset-2 hover:underline">
              {t("footer.terms")}
            </Link>
            <Link to="/privacy" className="underline-offset-2 hover:underline">
              {t("footer.privacy")}
            </Link>
            <Link to="/contact" className="underline-offset-2 hover:underline">
              {t("footer.contact")}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/** 行き先が無い URL。外枠の内側に出るので、ここには本文だけを置く */
export function NotFoundScreen() {
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
export function ErrorScreen({ error }: { error: unknown }) {
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
