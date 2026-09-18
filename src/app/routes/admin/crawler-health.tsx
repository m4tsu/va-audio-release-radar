import { createFileRoute, Link } from "@tanstack/react-router";
import { ADMIN_HEAD_META, AdminUnauthorized } from "@/app/components/admin-gate";
import { PageHeader } from "@/app/components/page-header";
import { storeLabel } from "@/app/components/store-badge";
import { Badge } from "@/app/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/components/ui/table";
import { handleAdminTokenQuery } from "@/app/lib/admin-token";
import { formatDateTime } from "@/app/lib/format";
import { cn } from "@/app/lib/utils";
import type { CrawlerHealthEntry } from "@/app/lib/view-types";
import { fetchCrawlerHealth } from "@/app/server-fns/admin";
import { fetchAdminSession } from "@/app/server-fns/admin-session";

/**
 * クローラー健全性 (企画書 §21)。声優 × ストアごとに直近の実行結果を並べる。
 *
 * パーサーが壊れると「エラーにはならないが 0 件」になる。成否だけでは気づけないので
 * 前回の成功時との件数差を並べて目で見て分かるようにする
 */
export const Route = createFileRoute("/admin/crawler-health")({
  server: {
    handlers: {
      GET: async ({ request, next }) => (await handleAdminTokenQuery(request)) ?? next(),
    },
  },
  loader: async () => {
    const session = await fetchAdminSession();
    if (!session.authorized) return { authorized: false as const, configured: session.configured };
    return { authorized: true as const, health: await fetchCrawlerHealth() };
  },
  head: () => ({
    meta: [{ title: "クローラー健全性 | 管理" }, ...ADMIN_HEAD_META],
  }),
  component: CrawlerHealthPage,
});

function CrawlerHealthPage() {
  const data = Route.useLoaderData();
  if (!data.authorized) return <AdminUnauthorized configured={data.configured} />;

  const { entries, last24h } = data.health;
  const warnings = entries.filter((entry) => entry.warning).length;

  return (
    <div>
      <PageHeader
        title="クローラー健全性"
        description={`直近 24 時間: 成功 ${last24h.ok} / 失敗 ${last24h.error}。要対応 ${warnings} 件。`}
        actions={
          <Link to="/admin/unmatched-credits" className="text-sm underline underline-offset-4">
            未解決クレジットへ
          </Link>
        }
      />

      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">まだクロールの記録がない。</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>声優</TableHead>
              <TableHead>ストア</TableHead>
              <TableHead>直近の実行</TableHead>
              <TableHead className="text-right">取得件数</TableHead>
              <TableHead className="text-right">前回比</TableHead>
              <TableHead className="text-right">新規</TableHead>
              <TableHead>状態</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <HealthRow key={`${entry.storeSlug}:${entry.voiceActorId}`} entry={entry} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function HealthRow({ entry }: { entry: CrawlerHealthEntry }) {
  const previous = entry.previousOk?.workCount;
  const diff = previous === undefined ? undefined : entry.latest.workCount - previous;

  return (
    <TableRow className={cn(entry.warning && "bg-destructive/10")}>
      <TableCell>
        {entry.voiceActorSlug ? (
          <Link
            to="/voice-actors/$slug"
            params={{ slug: entry.voiceActorSlug }}
            className="hover:underline"
          >
            {entry.voiceActorName ?? entry.voiceActorId}
          </Link>
        ) : (
          entry.voiceActorId
        )}
      </TableCell>
      <TableCell>{storeLabel(entry.storeSlug)}</TableCell>
      <TableCell className="text-muted-foreground">
        {formatDateTime(entry.latest.startedAt)}
      </TableCell>
      <TableCell className="text-right tabular-nums">{entry.latest.workCount}</TableCell>
      <TableCell
        className={cn(
          "text-right tabular-nums",
          diff !== undefined && diff < 0 && "text-destructive",
        )}
      >
        {diff === undefined ? "—" : `${diff > 0 ? "+" : ""}${diff}`}
      </TableCell>
      <TableCell className="text-right tabular-nums">{entry.latest.newCount}</TableCell>
      <TableCell className="whitespace-normal">
        {entry.latest.status === "error" ? (
          <Badge variant="destructive">失敗</Badge>
        ) : entry.warning ? (
          <Badge variant="destructive">要確認</Badge>
        ) : (
          <Badge variant="secondary">正常</Badge>
        )}
        {entry.warningReason ? (
          <p className="mt-1 text-muted-foreground text-xs">{entry.warningReason}</p>
        ) : null}
        {entry.latest.error ? (
          <p className="mt-1 text-destructive text-xs">{entry.latest.error}</p>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
