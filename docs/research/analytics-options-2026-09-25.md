# Cloudflare Web Analytics と Workers Analytics Engine で数えられるものと料金 (2026-09-25)

読者: 指標の計測手段 (`docs/decisions/0016-count-actions-in-analytics-engine.md`) を見直す人。料金や上限が変わったかを確かめるとき
更新: しない (日付つきの確認。引用を書き換えない)
削除: 参照する文書が無くなったら

公式文書を 2026-09-25 に読んだ結果。

## Cloudflare Web Analytics

- 任意のイベントは送れない。FAQ (https://developers.cloudflare.com/web-analytics/faq/) の
  カスタムイベントの項: "Not yet, but we may add support for this in the future."
- SPA は画面遷移ごとに送る。同じ FAQ: "For Single Page Applications, additional metrics are sent for every route change to capture the page load event."
- クエリ文字列は記録しない。同じ FAQ: "Cloudflare Web Analytics do not log query strings to avoid collecting potentially sensitive data."
- 無料。https://developers.cloudflare.com/web-analytics/about/ : "Cloudflare Web Analytics provides free, privacy-first analytics for your website without changing your DNS or using Cloudflare's proxy."
- クライアント側の状態を持たない。https://www.cloudflare.com/web-analytics/ : "Cloudflare Web Analytics does not use any client-side state, such as cookies or localStorage, to collect usage metrics."

## Workers Analytics Engine

https://developers.cloudflare.com/analytics/analytics-engine/pricing/ より。

- Workers Free で使える。1 日あたり書き込み 100,000 データポイント、読み取りクエリ 10,000 回が含まれる
- 課金はまだ始まっていない: "Currently, you will not be billed for your use of Workers Analytics Engine."
  料金は課金開始の前に見積もれるよう先に示してある、と同じページにある
- 読み取りは SQL API (`https://api.cloudflare.com/client/v4/accounts/{account_id}/analytics_engine/sql`)。
  トークンに `Account Analytics Read` の権限が要る (https://developers.cloudflare.com/analytics/analytics-engine/get-started/)

## Cloudflare Zaraz

`zaraz.track()` で任意のイベントを送れるが、受け取って数える先 (外部の解析ツール) を別に設定する
(https://developers.cloudflare.com/zaraz/web-api/track/)。
