# msa — pi の fork を masseater/typescript-template ベースに再構築する

## 次に着手するエージェントへ

`specs/msa/` の続きをやる。2026-10-15 時点の状況: **Phase A、slice 1 の途中。**

1. まず `slices/01-fence.md` を読み、それを片付けるまで他のことを触らない。fence（どの設定がどのパスを支配するか）
   が再構築全体の可否を決める。fence が成立していれば、以降の slice は機械的作業になる。
2. slice 1 の後は順番どおり: `02-delete-npm-machinery`、`03-pnpm-catalog`、`04-vp-check-strict-ratchet`、
   `05-ci-hooks-claude-docs`、`06-clean-clone-green`、`07-identity-rename`、`08-upstream-drill`。
   Phase B/C（オーケストレーター・worker・projects）は slice 8 より前に始めない。
3. 着手前に `npm install --ignore-scripts`（slice 3 以降は `pnpm install`）と `npm run hydrate:model-data` を実行する。
   hydrate しないと typecheck が通らない状態がある。
4. 作業を終える前にこの節（状況・再開位置・TODO）を更新する。

## 目的

`masseater/msa` は `earendil-works/pi` の public fork で、masseater 自身の agent harness にするためのもの。
fork したのは pi の中身（agent loop・provider 経路）に手を入れられるようにするため。この ladder は、upstream を
取り込み続けられる状態を保ったまま、リポジトリを `masseater/typescript-template` の規約で再構築する。

このリポジトリが最終的に載せる harness（Phase B/C。この ladder の対象外）:

- **orchestrator** — Claude Agent SDK が計画を立て、作業を配る。
- **worker** — 個々の作業は DeepSeek が実行する（pi の agent loop が動かす）。
- **projects** — Claude Code に出た projects 機能の再現。1 つの統括スレッドと複数の作業スレッド、共有メモリと
  ライブラリ、すべてが可視で住所を持つ。

## Phase A の非目標

- orchestrator・DeepSeek worker・projects のコードは書かない。
- npm publish はしない（下の「publish の決定」を参照）。
- pi の engine package をテンプレートの `libs/*` に移さない（「配置の決定」を参照）。
- pi の agent loop・provider・tool・TUI の挙動は変えない。
- テンプレートの Cloudflare / TanStack / drizzle / better-auth / alchemy の web app stack は採らない。

## 「typescript-template ベースに再構築」の解釈

msa を **単一ツールチェーン・単一ゲート** のリポジトリにする。テンプレートのツールチェーン（`pnpm` + `catalog:` +
`vp` + oxfmt/oxlint + 厳しい tsconfig + `verify` タスク 1 本 + `.claude` hooks + CI）がリポジトリを支配し、pi の
ソースは vendored のまま upstream とマージできる状態で残る。「グリーン」の定義は `vp run verify` ただ 1 つ。

## 決定と、負けた選択肢

| 決定 | 採用したもの | 負けた選択肢とその理由 |
| --- | --- | --- |
| pi の engine をどこに置くか | `packages/*` のまま、upstream remote を足す | `libs/*` への移動は workspace glob の設定にすぎず、`packages/` を直書きしている約 111 ファイルに毎回のマージ税を課す。msa が書くコードは `apps/ libs/ tools/ infra/` の形を使うので、両方併存でよい。upstream 追随をやめた時だけ再検討する。 |
| package scope | engine は `@earendil-works/*` のまま。改名しない | publish 可能な scope への改名は約 737 ファイル・約 1195 import・30 個の tsconfig alias・model catalog tooling に触れ、以後の upstream 取り込みすべてに衝突ノイズを足す。Phase B（最初の機能差分の直前）に 1 回だけやる。 |
| publish | Phase A では何も publish しない。npm の release 機構は削除する | msa が後で npm CLI を出すなら、release-please + 単一 package publish の枝を ladder に足す。 |
| vendored コードへの規約の適用 | **fence + ratchet** | テンプレートの厳しい tsconfig・oxlint categories・`no-comments`・`fallow` を 174k LOC の vendored コードにそのまま当てると、実測で約 374k LOC の書き換えになる。しかも、msa が手を入れるファイルほど upstream と衝突する。 |
| tsconfig の持ち方 | 2 つの base。msa のコードはテンプレートの strict、engine は pi の base + strict フラグを ratchet | 1 つの base では、msa 側の `noEmit`/bundler 解決と engine の `dist/` emit を両立できない。 |

## 実測ベースライン（2026-10-15、msa @ `4a5d3729`、`main` == upstream `main`）

fence の入力になる数字。`npm run fence:counts` で再現できる。

| 項目 | 値 |
| --- | --- |
| `packages/*/src` | 174,587 LOC / 673 ファイル（`packages/*/test` は 198,162 LOC / 644 `.test.ts`） |
| `tsc --noEmit -p tsconfig.json` | `npm ci --ignore-scripts` 直後から 0 errors（`npm run hydrate:model-data` の有無を問わず） |
| strict フラグを 1 つずつ足した時 | `exactOptionalPropertyTypes` 1081 ・`noUncheckedIndexedAccess` 1713 ・`noPropertyAccessFromIndexSignature` 2217 ・`noUnusedLocals` 22 ・`noImplicitReturns` 20 ・`noImplicitOverride` 11 ・`allowUnreachableCode:false` 4 ・他 0 |
| テンプレートの oxlint categories（11 中 4 package で測定） | 55,665 errors / 436 rules |
| `-D correctness -D suspicious`（同範囲） | 1,022 errors |
| `fallow dead-code --no-production` | 654 findings |
| `packages/*/src` のコメント行 | 25,595 行 / 1,126 ファイル（`no-comments: error` に対して） |
| 改名の対象 | `earendil-works` を参照するファイル 737（src 418・test 613・examples 164） |
| build なしの CLI 起動 | `node --import ./packages/coding-agent/src/experimental/source-resolver.ts packages/coding-agent/src/cli.ts --help` → exit 0 |
| 挙動の門番になるテスト | `test/suite/agent-session-queue.test.ts` — 15 tests、約 1.3 秒、faux provider |

## fence（1 つの関心に 1 つの持ち主）

| パス | formatter / linter | TypeScript | plugin・rule |
| --- | --- | --- | --- |
| `apps/**`, `libs/**`, `tools/**`, `*.config.ts`, `specs/**`（msa のコード） | `vp check`（oxfmt + oxlint、全 category、`denyWarnings`） | `tsconfig.base.json`（テンプレート strict + pi の `erasableSyntaxOnly`/`verbatimModuleSyntax`） | `no-comments`、`@r_masseater/oxlint-plugin-decision`、`fallow` — 全部 |
| `packages/**`（vendored pi engine） | oxfmt は pi の流儀（tabs・width 3・120 桁・`sortImports` off）、oxlint は `correctness` + `suspicious` のみ | emit は pi の `tsconfig.build.json`、strict フラグは **ratchet** | `no-comments` off、decision plugin off、`fallow` 除外 |

ratchet の規則: `tools/fence-counts.baseline.json` が strict フラグごとの error 数を記録する。`fence:check` は
どれかの数が **増えたら** 失敗する。数が減るのは自由（手を入れた vendored ファイルは、その機会に厳しくする）。

## slice 一覧

### Phase A — 再構築そのもの（この ladder）

| # | slice | 解禁される契約 | 依存 |
| --- | --- | --- | --- |
| 1 | [fence](slices/01-fence.md) | どの設定がどのパスを支配するかの確定、upstream の接ぎ目、実測ベースラインの記録 | — |
| 2 | [delete-npm-machinery](slices/02-delete-npm-machinery.md) | publish / release / nix / コミュニティ機構の削除。workflow 13 本 → 2 本 | 1 |
| 3 | [pnpm-catalog](slices/03-pnpm-catalog.md) | package manager 1 つ、lockfile 1 つ、宣言的なバージョン固定 | 2 |
| 4 | [vp-check-strict-ratchet](slices/04-vp-check-strict-ratchet.md) | `vp check` が fmt + lint + typecheck。biome / husky の削除、ratchet の常設化 | 3 |
| 5 | [ci-hooks-claude-docs](slices/05-ci-hooks-claude-docs.md) | `vp run verify` が唯一のゲート。hook と CI がそれだけを呼び、docs が msa を語る | 4 |
| 6 | [clean-clone-green](slices/06-clean-clone-green.md) | 他人の clone が手作業なしでグリーン | 5 |
| 7 | [identity-rename](slices/07-identity-rename.md) | harness が msa を名乗る（`msa` bin、`.msa` config ディレクトリ） | 6 |
| 8 | [upstream-drill](slices/08-upstream-drill.md) | upstream 取り込み手順が実測つきで文書化される | 7 |

### Phase B — engine と製品の接ぎ目（概要のみ、slice 未作成）

76k LOC の `packages/coding-agent` から `msa/tools`・`msa/session`（SDK。`ExtensionUI` ポートを持つ）・`apps/cli`
を切り出す。engine → 製品 → app の依存方向を機械的に検証できるようにし、木が静かなうちに scope 改名を 1 回で行う。
種になる形は upstream の `packages/coding-agent/examples/extensions/{subagent,plan-mode}/` に既にある。

### Phase C — 製品（概要のみ、slice 未作成）

`msa/projects`（pi-durable 上のドメイン + ストア）、`msa/orchestrator`（`Coordinator` ポートの裏の Claude Agent SDK。
役割→モデルの唯一の持ち主）、`msa/worker`（pi の既存 `packages/ai/src/providers/deepseek.ts` 経由の DeepSeek）、
projects の CLI / RPC / TUI 面、evals。

## 未確定（unknown）

- `vp` が emit 型（web でない）の monorepo build を回せるか。slice 3 の葉 package（`chord`・`telemetry`・`tui`）
  での spike で決着させる。回せない場合は `tsc -p tsconfig.build.json` を build の権威のまま残し、`vp` のタスク
  として呼ぶだけにする。
- `vp` 同梱の vitest が、既存の alias 設定のまま pi の 644 test ファイルを回せるか。同じ spike で見る。
- 手を入れた後の upstream 取り込みコスト。slice 8 で実測する。爆発するなら、製品コードを増やす前に
  pinned snapshot + patch ディレクトリ方式へ切り替える。
- Claude Agent SDK と pi が 1 つの Node プロセスで同居できるか。Phase B の最初の probe（`slices/08-upstream-drill.md`
  の follow-on probe）で確かめる。

## 中止・作り直しの条件

- vendored pi にテンプレートの full strictness・`no-comments`・lint categories をそのまま課す要求が出たら中止。
  実測で約 374k LOC の編集になる。目的から再決定する。
- slice 4 が 2 回の集中した試行でもグリーンにならない場合、ルールを 1 つずつ緩めるのではなく、実際に壊れた箇所から
  fence を引き直す。
- slice 8 の upstream drill で、最も手を入れている約 20 ファイルに解けない衝突が出たら、製品コードを足す前に
  vendoring の仕組みを変える。
