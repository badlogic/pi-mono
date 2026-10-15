# slice 04 — `vp check`、formatter / linter の一本化、strict ratchet

## 解禁される契約

format + lint + typecheck の入口が `vp check` だけになり、biome と husky は消える。house の strictness は
msa のコードには full で、vendored engine には実測つきの ratchet として適用される。

## 接ぎ目

- 新しい root `vite.config.ts`:
  - `fmt`（oxfmt）。`packages/**` は pi の流儀（`useTabs: true, tabWidth: 3, printWidth: 120,
    sortImports: false`）、msa のパスは house の既定。ignore は `packages/ai/src/models.generated.ts`・
    `**/*.generated.ts`・`packages/ai/src/providers/data/**`・`**/dist/**`。
  - `lint`（oxlint）は 2 つのスコープ。msa のパスには house の categories + `no-comments` +
    `@r_masseater/oxlint-plugin-decision`、`packages/**` には `correctness` + `suspicious` のみ
    （`no-comments` も decision plugin も無し。ゲートに `OPENROUTER_API_KEY` が要らなくなる）。
  - `run.tasks`: `verify`（`test-all`・`syncpack`・`gitleaks`・`audit`・`fence:check`・`entry-graphs` に依存）、
    `test-all`、`fence:check`。
- `tsconfig.base.json`: msa のパス向けの house strict フラグに、pi の `erasableSyntaxOnly`・
  `verbatimModuleSyntax`・`allowImportingTsExtensions`・`rewriteRelativeImportExtensions` を足す（pi の
  node type-stripping な開発フローが依存している）。engine は emit 用に pi の `tsconfig.build.json` のまま。
  strict の追加分は ratchet（slice 01 の `tools/fence-counts`）で守る。
- `biome.json`・`scripts/biome/`・`scripts/biome-check.mjs`・`.husky/`・`@biomejs/*` の devDeps・
  `prepare: husky` を削除。
- `vp config` で `.vite-hooks/{pre-commit,commit-msg,pre-push}`: `vp staged`、
  `vp exec commitlint --edit "$1"`、`vp run verify`。root に commitlint 設定。
- slice 01 の `tools/fence-counts.mjs` を `fence:check` タスクに昇格。

## house テンプレートから意図的に採らないもの

`eslint.config.ts` と web app 向け plugin 一式（`@eslint-react`・`@tanstack/*`・`drizzle`・`shadcn`・`steiger`・
`html-eslint`・`react-hooks`・`baseline-js`・tailwind）、`@effect/tsgo` の preset、vendored な英語 docs への
`textlint`/yomiyasu、`release-please`、`renovate`、`up-to-date.yml`、`autofix.yml`、`zap.yml`、Cloudflare の
`deploy` job と `ci-telemetry.sh`、`packages/**` への `fallow`、`.intent/` の skill ゲート。理由は
`specs/msa/README.md` にある。省略ではなく決定。

## 主要な unknown

house の `vite.config.ts` は Vite/Vitest の世代を抱えている。pi は `vitest@4.x` を固定し、手書きの config を 7 つと
`vitest.base.ts` の alias 一覧を持つ。まず `packages/agent`（4 ファイル）と `packages/mcp` で `vp test` を試し、
次に最大の `packages/ai` で試す。同梱の Vitest が回せないなら、pi の vitest を catalog から使ったまま `vp test` が
それを包む形にする（入口はどちらでも 1 つ）。

## 人が実行・確認できるもの

```bash
cd ~/ghq/github.com/masseater/msa
vp check                       # oxfmt + oxlint + typecheck、木全体
vp run verify                  # hook と CI が呼ぶ唯一のゲート
vp exec commitlint --from main --to HEAD
printf 'nope' > /tmp/m && vp exec commitlint --edit /tmp/m   # 失敗するはず
npm run fence:check            # ratchet は満たしたまま
test ! -e biome.json && test ! -d .husky && echo old-tooling-gone
```

## グリーンを保つもの

slice 03 のすべてに加えて、`packages/**` のファイルが 1 つも整形されていないこと。きれいな木で最初に
`vp fmt` を流した後、`git diff --stat -- packages` が空であることがそれを証明する。

## 任せる判断

- `fence:check` を pre-push に回すか CI だけか（`tsc` を何分も回すので既定は CI のみ、文書化する）。
- `specs/**` と `docs/**` に `no-comments` と decision plugin を効かせるか（既定: markdown には効かせない）。

## この設計をひっくり返す feedback

- 「engine も house の整形に合わせたい」と言われたら、それは約 374k LOC の決定であり、先に fence を決め直す。
