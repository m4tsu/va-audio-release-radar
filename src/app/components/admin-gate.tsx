import { PageHeader } from "@/app/components/page-header";

/** `/admin/*` の共通の head。運用画面なので検索結果には絶対に出さない */
export const ADMIN_HEAD_META = [{ name: "robots", content: "noindex" }] as const;

/**
 * トークンが通っていないときの表示。
 * `?token=` を付けて開き直す手順まで出す (管理者しか見ない画面なので隠さない)
 */
export function AdminUnauthorized({ configured }: { configured: boolean }) {
  return (
    <div>
      <PageHeader title="管理者トークンが必要です" />
      <p className="text-muted-foreground text-sm">
        {configured
          ? "このページの URL に ?token=<ADMIN_TOKEN> を付けて開き直すこと。トークンは HttpOnly cookie に保存され、URL からは取り除かれる。"
          : "サーバーに ADMIN_TOKEN が設定されていない。`wrangler secret put ADMIN_TOKEN` (ローカルは .dev.vars) で設定すること。"}
      </p>
    </div>
  );
}
