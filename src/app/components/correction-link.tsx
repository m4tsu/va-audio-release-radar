import { Link } from "@tanstack/react-router";
import { useT } from "@/app/i18n";

/**
 * 掲載内容の訂正を申し出る入口。作品ページと声優ページの末尾に置く。
 *
 * 種別と対象のページを `/contact` へ URL で渡す。渡さないと、気づいた人が対象の作品名や
 * 声優名を自分で書き写すことになり、受け取る側もどのページの話かを本文から当てることになる。
 * 欄の読み方と既定は `@/app/lib/contact-search`
 */
export function CorrectionLink({ path }: { path: string }) {
  const t = useT();

  return (
    <p className="text-muted-foreground text-xs">
      <Link
        to="/contact"
        search={{ kind: "correction", about: path }}
        className="underline underline-offset-4 hover:text-foreground"
      >
        {t("contact.correctionLink")}
      </Link>
    </p>
  );
}
