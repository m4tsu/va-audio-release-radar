import { Link } from "@tanstack/react-router";
import { AdminNav, AdminUnauthorized } from "@/app/components/admin-gate";
import { PageHeader } from "@/app/components/page-header";
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
import { formatDateTime } from "@/app/lib/format";
import type { Inquiry } from "@/domain/types";

export type AdminInquiriesPageProps =
  | { authorized: false; configured: boolean }
  | { authorized: true; inquiries: Inquiry[]; page: number; hasNext: boolean };

/**
 * 届いた問い合わせの一覧。新しい順に並べて読むだけの画面。
 *
 * 対応状況も返信もここでは持たない。書き込む手段を足すと、どの行を誰が触ったかを
 * 残す仕組みが要る。まず「届いたものが読める」ことだけを満たす
 */
export function AdminInquiriesPage(props: AdminInquiriesPageProps) {
  const t = useT();
  if (!props.authorized) return <AdminUnauthorized configured={props.configured} />;

  const { inquiries, page, hasNext } = props;

  return (
    <div>
      <PageHeader
        title={t("admin.inquiriesTitle")}
        description={t("admin.inquiriesSummary", { count: inquiries.length })}
        actions={<AdminNav current="inquiries" />}
      />

      {inquiries.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("admin.inquiriesEmpty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("admin.inquiriesColumnReceivedAt")}</TableHead>
              <TableHead>{t("admin.inquiriesColumnKind")}</TableHead>
              <TableHead>{t("admin.inquiriesColumnBody")}</TableHead>
              <TableHead>{t("admin.inquiriesColumnContact")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {inquiries.map((inquiry) => (
              <InquiryRow key={inquiry.id} inquiry={inquiry} />
            ))}
          </TableBody>
        </Table>
      )}

      <Pager page={page} hasNext={hasNext} />
    </div>
  );
}

function InquiryRow({ inquiry }: { inquiry: Inquiry }) {
  const t = useT();
  const locale = useLocale();

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {formatDateTime(inquiry.receivedAt, locale)}
      </TableCell>
      <TableCell>
        <Badge variant="secondary">{t(`admin.inquiryKind.${inquiry.kind}`)}</Badge>
      </TableCell>
      {/* 送信者が書いた文そのもの。改行が意味を持つので折り返しと改行を保つ */}
      <TableCell className="max-w-prose whitespace-pre-wrap break-words">{inquiry.body}</TableCell>
      <TableCell className="break-words">
        {inquiry.contact === undefined ? (
          // 未記入と「連絡先を読み落とした」を見分けられるよう、空欄にせず言葉で出す
          <span className="text-muted-foreground">{t("admin.inquiriesNoContact")}</span>
        ) : (
          inquiry.contact
        )}
      </TableCell>
    </TableRow>
  );
}

/**
 * 続きへの行き先。ページ番号は URL に置くので、2 ページ目を開いたまま再読み込みしても同じ位置に戻る。
 * 1 ページ目は欄を持たせない (素の URL と `?page=1` で同じ画面が 2 つの住所を持たないようにする)
 */
function Pager({ page, hasNext }: { page: number; hasNext: boolean }) {
  const t = useT();
  const previous = page - 1;

  return (
    <nav aria-label={t("admin.inquiriesPagination")} className="mt-6 flex items-center gap-4">
      {previous >= 1 ? (
        <Link
          to="/admin/inquiries"
          // 1 ページ目は欄を持たないので `undefined` を明に渡す。省くとルーターが
          // 「今の欄の一部と一致する」と見て、現在地でないリンクに aria-current を付ける
          search={{ page: previous === 1 ? undefined : previous }}
          activeOptions={{ includeSearch: true, explicitUndefined: true }}
          className="text-sm underline underline-offset-4"
        >
          {t("admin.inquiriesPrev")}
        </Link>
      ) : null}
      <span className="text-muted-foreground text-sm">{t("admin.inquiriesPage", { page })}</span>
      {hasNext ? (
        <Link
          to="/admin/inquiries"
          search={{ page: page + 1 }}
          className="text-sm underline underline-offset-4"
        >
          {t("admin.inquiriesNext")}
        </Link>
      ) : null}
    </nav>
  );
}
