import type { ReactNode } from "react";

/** 各ページの見出し。h1 は 1 ページに 1 つだけ置く (SEO 上、声優名を拾わせたいのはここ) */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
