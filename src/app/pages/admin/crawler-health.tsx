import { Link } from "@tanstack/react-router";
import { AdminUnauthorized } from "@/app/components/admin-gate";
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
import { useLocale, useT } from "@/app/i18n";
import { actorDisplayName } from "@/app/lib/actor-name";
import { formatDateTime } from "@/app/lib/format";
import { cn } from "@/app/lib/utils";
import type { CrawlerHealth, CrawlerHealthEntry } from "@/app/lib/view-types";

export type CrawlerHealthPageProps =
  | { authorized: false; configured: boolean }
  | { authorized: true; health: CrawlerHealth };

/**
 * クローラー健全性。声優 × ストアごとに直近の実行結果を並べる。
 *
 * パーサーが壊れると「エラーにはならないが 0 件」になる。成否だけでは気づけないので
 * 前回の成功時との件数差を並べて目で見て分かるようにする
 */
export function CrawlerHealthPage(props: CrawlerHealthPageProps) {
  const t = useT();
  if (!props.authorized) return <AdminUnauthorized configured={props.configured} />;

  const { entries, last24h } = props.health;
  const warnings = entries.filter((entry) => entry.warning).length;

  return (
    <div>
      <PageHeader
        title={t("admin.healthTitle")}
        description={t("admin.healthSummary", {
          ok: last24h.ok,
          error: last24h.error,
          warnings,
        })}
        actions={
          <Link to="/admin/unmatched-credits" className="text-sm underline underline-offset-4">
            {t("admin.healthToUnmatched")}
          </Link>
        }
      />

      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("admin.healthEmpty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("admin.healthColumnActor")}</TableHead>
              <TableHead>{t("admin.healthColumnStore")}</TableHead>
              <TableHead>{t("admin.healthColumnLatestRun")}</TableHead>
              <TableHead className="text-right">{t("admin.healthColumnWorkCount")}</TableHead>
              <TableHead className="text-right">{t("admin.healthColumnCoverage")}</TableHead>
              <TableHead className="text-right">{t("admin.healthColumnDiff")}</TableHead>
              <TableHead className="text-right">{t("admin.healthColumnNew")}</TableHead>
              <TableHead>{t("admin.healthColumnStatus")}</TableHead>
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

/**
 * 網羅率の列。ストアの総件数に対して何件取れたかを出す。
 *
 * 分母はストアが出す総件数、分子は保存した件数。成人向けを除いた分だけ分子が小さくなることが
 * あるので、取りこぼしの判定は数字の比較ではなくクローラーが記録した `coverageComplete` で行う。
 * 総件数を読めなかった run は「—」にする。完全と取り違えないため
 */
function CoverageCell({ latest }: { latest: CrawlerHealthEntry["latest"] }) {
  const t = useT();
  const incomplete = latest.coverageComplete === false;
  return (
    <TableCell
      className={cn("text-right tabular-nums", incomplete && "font-medium text-destructive")}
      title={incomplete ? t("admin.healthCoverageIncomplete") : undefined}
    >
      {latest.totalCount === undefined ? "—" : `${latest.workCount}/${latest.totalCount}`}
    </TableCell>
  );
}

function HealthRow({ entry }: { entry: CrawlerHealthEntry }) {
  const t = useT();
  const locale = useLocale();
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
            {entry.voiceActorName
              ? actorDisplayName({ canonicalName: entry.voiceActorName }, locale)
              : entry.voiceActorId}
          </Link>
        ) : (
          entry.voiceActorId
        )}
      </TableCell>
      <TableCell>{storeLabel(entry.storeSlug)}</TableCell>
      <TableCell className="text-muted-foreground">
        {formatDateTime(entry.latest.startedAt, locale)}
      </TableCell>
      <TableCell className="text-right tabular-nums">{entry.latest.workCount}</TableCell>
      <CoverageCell latest={entry.latest} />
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
          <Badge variant="destructive">{t("admin.healthStatusError")}</Badge>
        ) : entry.warning ? (
          <Badge variant="destructive">{t("admin.healthStatusWarning")}</Badge>
        ) : (
          <Badge variant="secondary">{t("admin.healthStatusOk")}</Badge>
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
