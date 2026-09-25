import { Link } from "@tanstack/react-router";
import { PageHeader } from "@/app/components/page-header";
import { useT } from "@/app/i18n";

/** `/admin/*` の共通の head。運用画面なので検索結果には絶対に出さない */
export const ADMIN_HEAD_META = [{ name: "robots", content: "noindex" }] as const;

/**
 * トークンが通っていないときの表示。
 * `?token=` を付けて開き直す手順まで出す (管理者しか見ない画面なので隠さない)
 */
export function AdminUnauthorized({ configured }: { configured: boolean }) {
  const t = useT();
  return (
    <div>
      <PageHeader title={t("admin.unauthorizedTitle")} />
      <p className="text-muted-foreground text-sm">
        {configured ? t("admin.unauthorizedConfigured") : t("admin.unauthorizedMissing")}
      </p>
    </div>
  );
}

/**
 * 管理画面どうしの行き来。各ページが互いへのリンクを持つと、画面が増えるたびに
 * 組み合わせの数だけ書き足すことになるため、行き先の一覧から作る
 */
const ADMIN_PAGES = [
  { key: "health", to: "/admin/crawler-health", label: "admin.toHealth" },
  { key: "unmatched", to: "/admin/unmatched-credits", label: "admin.toUnmatched" },
  { key: "inquiries", to: "/admin/inquiries", label: "admin.toInquiries" },
] as const;

/** 今いる画面は出さない。自分自身へのリンクは行き先にならない */
export function AdminNav({ current }: { current: (typeof ADMIN_PAGES)[number]["key"] }) {
  const t = useT();
  return (
    <>
      {ADMIN_PAGES.filter((page) => page.key !== current).map((page) => (
        <Link key={page.key} to={page.to} className="text-sm underline underline-offset-4">
          {t(page.label)}
        </Link>
      ))}
    </>
  );
}
