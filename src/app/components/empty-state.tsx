import type { ReactNode } from "react";

/** 何も無いときの枠。「壊れている」のか「まだ無い」のかを読み手に区別させるために置く */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {description ? (
        <p className="mx-auto mt-2 max-w-md text-muted-foreground text-sm">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
