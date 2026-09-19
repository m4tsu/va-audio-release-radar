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
