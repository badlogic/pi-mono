# slice 03 — pnpm + catalog

## 解禁される契約

package manager が 1 つになり、lockfile が 1 つになり、バージョンは 1 つの表で宣言される。内部依存は
`1.2.0` のような実バージョン固定ではなく workspace link になり、npm から別物が解決される事故が起きなくなる。

## 接ぎ目

- 新しい `pnpm-workspace.yaml`:
  - `packages`: `packages/*`・`apps/*`・`libs/*`・`infra/*`・`tools/*`・`.claude`、および
    `packages/coding-agent/examples/extensions/*` の 5 つ。
  - `catalogMode: prefer` と、外部依存（重複を除いて 51 個）を pi の固定バージョンで並べた `catalog:`、
    `overrides: { protobufjs: 7.6.6 }`、`saveExact: true`、`.npmrc` の `min-release-age` の意図を移した設定。
- 11 package と 5 example member の `"@earendil-works/pi-*": "1.2.0"` を `"workspace:*"` に。
  本当に外部の `@earendil-works/*`（`gondolin` など）は実バージョンのまま。
- `package-lock.json`・`.npmrc`・root の `workspaces` フィールド・
  `packages/coding-agent/examples/extensions/with-deps/package-lock.json` を削除。
- root `package.json`: `packageManager` を固定。`build` は `pnpm -r --workspace-concurrency=1 run build`
  （または今の順序を再現する明示的な `--filter`: chord → tui → telemetry → codemode → mcp → ai → durable →
  env → agent → coding-agent）。package 内スクリプトと `.mjs` ヘルパーの `npm --prefix ../x` は
  `pnpm --filter <name>` に。
- `.husky` はここでは残す（slice 04 が置き換える）。

## 主要な unknown（隠さず書く）

npm は推移的依存をすべて hoist するが pnpm はしない。宣言していない依存を import していると、install は通るのに
解決が失敗する。対応の梯子:

1. 既定の isolated `node_modules`（pnpm 本来の挙動。これを望んでいる）。
2. import している package に依存を宣言する（正しい修正。数個で済むなら必ずこれをやる）。
3. 依存木の都合で 2 が現実的でない時だけ `.npmrc` の `node-linker=hoisted`（強制した package 名をコメントに残す）。

## 他の 8 package を触る前の spike

まず `packages/chord`・`packages/telemetry`・`packages/tui` の 3 つだけを変換し、
`pnpm install --frozen-lockfile && pnpm -r run build && pnpm -r run test` が通ることを示す。それから残りを変換する。
「`vp` が web でない emit 型 monorepo を回せるか」はここで白黒つける。

## 人が実行・確認できるもの

```bash
cd ~/ghq/github.com/masseater/msa
rm -rf node_modules packages/*/node_modules
pnpm install
pnpm -r run build
pnpm -r run test
node packages/coding-agent/dist/cli.js --help        # build が出す成果物のパスに合わせる
bash pi-test.sh --version
test -f pnpm-lock.yaml && test ! -f package-lock.json
pnpm ls -r --depth -1 | grep pi-ai                   # link:packages/ai に解決される
```

## グリーンを保つもの

644 個の test ファイル全部、`tsc --noEmit` = 0 errors、ソースからの CLI、
`node scripts/check-entry-graphs.mjs`、`packages/tui` の native ビルドが読めること。

## 任せる判断

- `build` を `pnpm -r` のトポロジカル順にするか明示 `--filter` 順にするか（今の順序を再現する楽な方）。
- `apps/`・`libs/`・`infra/`・`tools/` の glob を今足すか、最初の msa package を作る slice で足すか
  （既定: 今足して、トポロジーだけ先に存在させる）。

## この設計をひっくり返す feedback

- `node-linker=hoisted` でないと build できないなら、宣言漏れを隠す link mode を黙って受容せず、fence 文書に
  はっきり書く。
