import { Link } from "@tanstack/react-router";
import { AdminNav, AdminUnauthorized } from "@/app/components/admin-gate";
import { AssignCreditForm } from "@/app/components/assign-credit-form";
import { CreditExclusionButton } from "@/app/components/credit-exclusion-button";
import { PageHeader } from "@/app/components/page-header";
import { storeLabel } from "@/app/components/store-badge";
import { Badge } from "@/app/components/ui/badge";
import { useLocale, useT } from "@/app/i18n";
import { formatDateTime } from "@/app/lib/format";
import type { ActorSummary, ExcludedCreditName, UnmatchedCreditGroup } from "@/app/lib/view-types";

export type UnmatchedCreditsPageProps =
  | { authorized: false; configured: boolean }
  | {
      authorized: true;
      groups: UnmatchedCreditGroup[];
      actors: ActorSummary[];
      excluded: ExcludedCreditName[];
    };

/**
 * 未解決クレジットの割り当て。
 *
 * 名寄せできなかったストア上の表記を、人が見て声優に結び付ける。
 * 割り当ては「表記 × ストア」単位でまとめて行う。同じ声優が同じ表記で何十作品にも出るため。
 * 対象声優ではない表記は「対象外」の印を付けてキューから外し、下の一覧で印を外せる。
 * 送信そのものは `components/assign-credit-form.tsx` と `components/credit-exclusion-button.tsx`
 */
export function UnmatchedCreditsPage(props: UnmatchedCreditsPageProps) {
  const t = useT();
  if (!props.authorized) return <AdminUnauthorized configured={props.configured} />;

  const { groups, actors, excluded } = props;

  return (
    <div>
      <PageHeader
        title={t("admin.unmatchedTitle")}
        description={t("admin.unmatchedSummary", { count: groups.length })}
        actions={<AdminNav current="unmatched" />}
      />

      {groups.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("admin.unmatchedEmpty")}</p>
      ) : (
        <ul className="space-y-4">
          {groups.map((group) => (
            <li key={`${group.sourceStoreSlug}:${group.creditedName}`}>
              <CreditGroupCard group={group} actors={actors} />
            </li>
          ))}
        </ul>
      )}

      <ExcludedNames excluded={excluded} />
    </div>
  );
}

function ExcludedNames({ excluded }: { excluded: ExcludedCreditName[] }) {
  const t = useT();
  const locale = useLocale();
  return (
    <section aria-labelledby="excluded-credit-names" className="mt-10 space-y-3">
      <h2 id="excluded-credit-names" className="font-semibold text-lg">
        {t("admin.excludedTitle")}
      </h2>
      {excluded.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("admin.excludedEmpty")}</p>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            {t("admin.excludedSummary", { count: excluded.length })}
          </p>
          <ul className="divide-y rounded-xl border">
            {excluded.map((name) => (
              <li
                key={`${name.sourceStoreSlug}:${name.creditedName}`}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">{name.creditedName}</span>
                  <Badge variant="outline">{storeLabel(name.sourceStoreSlug)}</Badge>
                  <span className="text-muted-foreground text-sm">
                    {t("admin.excludedSince", { date: formatDateTime(name.createdAt, locale) })}
                  </span>
                </div>
                <CreditExclusionButton name={name} action="restore" />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function CreditGroupCard({
  group,
  actors,
}: {
  group: UnmatchedCreditGroup;
  actors: ActorSummary[];
}) {
  const t = useT();
  return (
    <div className="space-y-4 rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex flex-wrap items-baseline gap-2">
        {/* 表記そのものはストア上の書き方。訳さない */}
        <span className="font-medium text-lg">{group.creditedName}</span>
        <Badge variant="outline">{storeLabel(group.sourceStoreSlug)}</Badge>
        <span className="text-muted-foreground text-sm">
          {t("admin.unmatchedCount", { count: group.count })}
        </span>
      </div>

      {group.sampleWorks.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {group.sampleWorks.map((work) => (
            <li key={work.id}>
              <Link
                to="/works/$id"
                params={{ id: work.id }}
                className="text-muted-foreground hover:text-foreground hover:underline"
              >
                {work.title}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <AssignCreditForm group={group} actors={actors} />

      <CreditExclusionButton name={group} action="exclude" />
    </div>
  );
}
