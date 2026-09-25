import { ExternalLink } from "lucide-react";
import { useT } from "@/app/i18n";
import { safeHttpsUrl } from "@/app/lib/safe-url";
import { countedLinkHandlers } from "@/app/lib/usage-events";
import type { WorkDetail } from "@/app/lib/view-types";

/**
 * Audible の無料体験への登録の導線 (バリューコマースのテキストリンク)。
 *
 * - Audible は作品ごとのアフィリエイトリンクを作れないので、報酬になるのはこの登録だけ
 * - 文言は Audible が Amazon のサービスだと分かるように書き、その作品が無料で聴けるとは読めないようにする。
 *   このサイトは価格も聴き放題の対象かも持たない (docs/decisions/0008-no-price-no-availability.md)
 * - 広告コードに入っている計測画像をリンクの中に出す。描画した時点でブラウザから計測のサーバーへ通信が出る
 *   (プライバシーポリシーの外部通信の節、`src/app/legal/privacy.ts`)
 * - 押したら数える。作品ごとのストアへのリンクとは別の操作として数える (`@/app/lib/usage-events`)
 */
export function AudibleTrialLink({ link }: { link: NonNullable<WorkDetail["audibleTrial"]> }) {
  const t = useT();
  const href = safeHttpsUrl(link.url);
  if (!href) return null;
  const beaconUrl = safeHttpsUrl(link.beaconUrl);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener nofollow sponsored"
      {...countedLinkHandlers({ type: "audible_trial_click" })}
      className="inline-flex items-center gap-1 text-sm underline underline-offset-4 hover:text-foreground"
    >
      {beaconUrl ? (
        // 広告コードの画像をそのまま写す。改変にあたらないとされる変更は alt の追加などに限られるので、
        // 大きさと border も配られたコードのとおりにする (docs/stores/audible.md の「既知の落とし穴」)
        <img src={beaconUrl} alt="" height={1} width={1} {...{ border: "0" }} />
      ) : null}
      {t("work.audibleTrial")}
      <ExternalLink aria-hidden="true" className="size-3.5" />
    </a>
  );
}
