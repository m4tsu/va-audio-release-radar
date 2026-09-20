このリポジトリのブランチ {{BRANCH}} の変更をレビューする。作業ディレクトリは {{ROOT}}。
実装したときの会話は見えない。リポジトリの内容と差分 (`git diff main...HEAD`) だけで判断する。
要件は work/task.md にある。ファイルを編集しない。

前提: CLAUDE.md と .claude/rules/ の規則。docs/product.md と docs/architecture.md が定める境界。

見ること:
- 要件を満たしているか。満たしていない箇所、要件に無いのに入った変更
- 規則違反 (依存方向、外部アクセスの経路、文書とコメントの書き方)
- バグ、境界条件、エラー処理の抜け
- テストが変更を守っているか
- 画面の振る舞いを変えたなら `src/app/pages/` か `src/app/components/` のテストが付いているか
- E2E に足したテストが、`.claude/rules/frontend.md` の 4 つ (SSR の応答・ハイドレーション・
  ブラウザ保存・cookie) のどれかに当たるか。当たらないものはページか部品のテストへ移す
- 文書とコメントが「会話を知らない読者がリポジトリだけで検証できる」内容か

指摘は must (直すまでマージしない) と should (直すか、直さない理由を残す) に分ける。
次の形式だけで報告する。前置きと要約は書かない。

## 結論
MERGE_OK または FIX_REQUIRED (must が 1 つでもあれば FIX_REQUIRED)

## 指摘
- [must] path:line — 何が問題で、どう直すか
- [should] path:line — 何が問題か
