import { CircleHelp } from "lucide-react";
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/app/components/ui/popover";

/**
 * 見出しの隣に置くヘルプの印。常に出すほどではない補足を、押したときだけ見せる。
 *
 * 押す (タップ・Enter・Space) と開いたままになり、もう一度押すか Esc か外を押すと閉じる。
 * マウスは重ねるだけでも開き、離れると閉じる。重ねて開いた後に押すと、閉じずに開いたままにする
 * (重ねた時点で開いているので、そのまま押すと閉じてしまい、押した人の意図と逆になる)。
 *
 * `label` は印の読み上げ名。アイコンだけでは何の説明か分からないので必ず渡す
 */
export function HelpPopover({ label, children }: { label: string; children: ReactNode }) {
  // hover: 重ねて開いた (離れたら閉じる)。pinned: 押して開いた (離れても閉じない)
  const [mode, setMode] = useState<"closed" | "hover" | "pinned">("closed");
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 閉じたときにフォーカスを印へ戻すか。押して開いたときだけ戻す (重ねて開いたときは元々印に無い)
  const returnFocus = useRef(false);

  const cancelClose = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  // 印から吹き出しへマウスを移す間に隙間を通るので、離れてすぐには閉じない
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      returnFocus.current = false;
      setMode((current) => (current === "hover" ? "closed" : current));
    }, 150);
  };

  // 外した後に閉じる予約が走って、消えた部品の状態を書き換えないようにする
  useEffect(
    () => () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    },
    [],
  );

  const onPointerEnter = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    cancelClose();
    setMode((current) => (current === "closed" ? "hover" : current));
  };

  const onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    scheduleClose();
  };

  return (
    <Popover
      open={mode !== "closed"}
      onOpenChange={(open) => {
        cancelClose();
        returnFocus.current = mode === "pinned";
        setMode(open ? "pinned" : "closed");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          className="rounded-full text-muted-foreground"
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
          onClick={(event) => {
            // Radix の開閉の切り替えを止め、重ねて開いた後の押下を「開いたままにする」にする
            event.preventDefault();
            cancelClose();
            returnFocus.current = true;
            setMode(mode === "pinned" ? "closed" : "pinned");
          }}
        >
          <CircleHelp aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        // 狭い画面で吹き出しが画面の端に貼り付かないよう、ページの余白と同じだけ離す
        collisionPadding={16}
        aria-label={label}
        className="max-w-[calc(100vw-2rem)] space-y-2 text-sm"
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        // 重ねただけで開いたときは、読んでいる場所からフォーカスを奪わない
        onOpenAutoFocus={(event) => {
          if (mode === "hover") event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          if (!returnFocus.current) event.preventDefault();
        }}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
