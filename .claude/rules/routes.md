---
description: dev サーバーが動いている間はルートファイルを cp や mv で上書きしない
paths:
  - "src/app/routes/**"
  - "src/router.tsx"
---

# ルートファイルの規則

## dev サーバーが動いている間に `cp` や `mv` で上書きしない

TanStack Router のプラグインが `src/app/routes/**` を監視していて、上書きの瞬間にファイルが空になると
新規ルートとみなして定型のひな形で書き戻す。ビルドもテストも通るので、ブラウザで見るまで気づけない。

- 編集は Edit / Write ツールで行う
- ファイルごと差し替えたいときは dev サーバーを止めてから行う
- `src/app/routeTree.gen.ts` は生成物。手で編集しない

## `__root.tsx` の `<html>` から外してはいけないもの

`<html>` の `suppressHydrationWarning` と head のインラインスクリプト (`themeScript`) は対になっている。
スクリプトが最初の描画より前に `.dark` を付けるので、サーバー出力と class が食い違うのが正常で、
属性はその差分だけを黙らせる。属性を外すとダークの初回描画ごとに警告が出て、スクリプトを外すと白から黒へのちらつきが出る。
