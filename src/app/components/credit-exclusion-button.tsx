import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { useT } from "@/app/i18n";
import { excludeCreditNameFn, unexcludeCreditNameFn } from "@/app/server-fns/admin";
import type { StoreSlug } from "@/domain/types";

type CreditName = { creditedName: string; sourceStoreSlug: StoreSlug };

type SubmitState = { phase: "idle" | "saving" } | { phase: "error"; message: string };

/**
 * 表記 × ストアに「対象声優ではない」の印を付ける / 外すボタン。
 *
 * 付けても外しても、表記は未解決キューと対象外の一覧のあいだを移るだけなので、
 * 成功したらローダーを引き直して両方を描き直す
 */
export function CreditExclusionButton({
  name,
  action,
}: {
  name: CreditName;
  action: "exclude" | "restore";
}) {
  const t = useT();
  const router = useRouter();
  const [state, setState] = useState<SubmitState>({ phase: "idle" });

  const labels =
    action === "exclude"
      ? {
          idle: t("admin.unmatchedExclude"),
          saving: t("admin.unmatchedExcluding"),
          error: t("admin.unmatchedExcludeError"),
        }
      : {
          idle: t("admin.excludedRestore"),
          saving: t("admin.excludedRestoring"),
          error: t("admin.excludedRestoreError"),
        };

  const submit = async () => {
    setState({ phase: "saving" });
    const data = { creditedName: name.creditedName, sourceStoreSlug: name.sourceStoreSlug };
    try {
      await (action === "exclude"
        ? excludeCreditNameFn({ data })
        : unexcludeCreditNameFn({ data }));
      await router.invalidate();
    } catch (error) {
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : labels.error,
      });
    }
  };

  return (
    <div className="space-y-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={state.phase === "saving"}
        onClick={() => void submit()}
      >
        {state.phase === "saving" ? labels.saving : labels.idle}
      </Button>
      {state.phase === "error" ? <p className="text-destructive text-sm">{state.message}</p> : null}
    </div>
  );
}
