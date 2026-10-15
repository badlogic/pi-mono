# toolchain の fence

1 つの関心に 1 つの持ち主。このファイルが「どの設定がどのパスを支配するか」を決める。これが無いと「house の
ツールチェーンを採る」は vendored engine の書き換えを意味してしまう。

## 何を解決するか

msa は pi の engine（`src` 174,587 LOC、`test` 198,162 LOC）を vendored で持ち、手を入れられるようにしている。
`masseater/typescript-template` の規約は、その規約の下で新しく書くコードのために設計されている。vendored コードに
そのまま当てると、整形の変更ではなく書き換えになる。2026-10-15、`4a5d3729` での実測:

| house のルール | vendored engine に当てた時のコスト |
| --- | --- |
| `exactOptionalPropertyTypes` | 1,081 errors |
| `noUncheckedIndexedAccess` | 1,713 errors |
| `noPropertyAccessFromIndexSignature` | 2,217 errors |
| `noImplicitOverride` / `noImplicitReturns` / `noUnusedLocals` / `allowUnreachableCode: false` | 11 / 20 / 22 / 4 errors |
| house の oxlint categories（11 package 中 4 package で測定） | 55,665 errors / 436 rules |
| `fallow dead-code --no-production` | 654 findings |
| `no-comments`（2 = error） | コメント 25,595 行 / 1,126 ファイル |
| 再整形（tabs・width 3 → oxfmt の既定） | vendored ファイル全件 |

再整形は fork の目的にとってもっとも悪い選択でもある。msa が手を入れるファイルほど、以降の upstream 変更が必ず
衝突するようになる。だから engine は自前の整形を保ち、差は ratchet として記録し、house のルールは msa が新しく
書くコードに full で適用する。

## fence

| パス | formatter / linter | TypeScript | plugin・rule |
| --- | --- | --- | --- |
| `packages/**` — vendored pi engine | oxfmt は pi の流儀（tabs・width 3・120 桁・`sortImports: false`）、oxlint は `correctness` + `suspicious` のみ | emit は pi の `tsconfig.build.json`、追加の strict フラグは ratchet | `no-comments` off、decision plugin off、`fallow` 除外 |
| `apps/**`, `libs/**`, `tools/**`, `infra/**`, `*.config.ts` — msa のコード | `vp check`（oxfmt の既定 + `sortImports: true`、oxlint 全 category、`denyWarnings`） | `tsconfig.base.json` の house strict | `no-comments`、`@r_masseater/oxlint-plugin-decision`、`fallow` — 全部 |
| `packages/ai/src/models.generated.ts`, `**/*.generated.ts`, `packages/ai/src/providers/data/**` | どちらも無視 | — | — |
| `specs/**`, `docs/**`, `*.md` | 必要なら prose lint のみ | — | `no-comments` と decision plugin は適用しない |

`packages/**` のファイルは `vp fmt` で整形されない。きれいな木で最初に `vp fmt` を流した時、
`git diff --stat -- packages` が空であることが fence の証明になる。

## ratchet

engine は自前の設定ですでにグリーン（`tsc --noEmit -p tsconfig.json` → 0 errors）。追加の strict フラグは
先送りではなく、数値として記録する:

```sh
npm run fence:counts   # 測定して tools/fence-counts.baseline.json を書き換える
npm run fence:check    # 測定して、どれかの数が増えていたら失敗する
```

`tools/fence-counts.baseline.json` はフラグごとの数と、測定時の commit を持つ。数はいつでも下げてよい（手を
入れたファイルは、関係するフラグの分だけ厳しくする）。上げてはならない。typecheck を 11 回走らせるので、
pre-push ではなく独立したコマンドにしている。

2026-10-15、`4a5d3729` での実測:

| フラグ | errors |
| --- | --- |
| `exactOptionalPropertyTypes` | 1081 |
| `noUncheckedIndexedAccess` | 1713 |
| `noPropertyAccessFromIndexSignature` | 2217 |
| `noUnusedLocals` | 22 |
| `noImplicitReturns` | 20 |
| `noImplicitOverride` | 11 |
| `allowUnreachableCode: false` | 4 |
| `noFallthroughCasesInSwitch` | 0 |
| `noUnusedParameters` | 0 |
| `noUncheckedSideEffectImports` | 0 |
| `allowUnusedLabels` | 0 |

## base config を 2 つ持つ理由

1 つの base では、engine の `dist/` emit と msa コードの house 流 `noEmit` を両立できない。

- `packages/**` — pi の `tsconfig.base.json`（`module`/`moduleResolution` Node16、`declaration`、`erasableSyntaxOnly`、
  `verbatimModuleSyntax`、`allowImportingTsExtensions`、`rewriteRelativeImportExtensions`）と、package ごとの
  `tsconfig.build.json`。
- msa のコード — house の `tsconfig.base.json`（strict フラグ一式）に `erasableSyntaxOnly` と `verbatimModuleSyntax`
  を足したもの（pi の node type-stripping な開発フローがこの 2 つに依存している）。

## house テンプレートから意図的に採らないもの

`eslint.config.ts` と web app 向け plugin 一式（`@eslint-react`・`@tanstack/*`・`drizzle`・`shadcn`・`steiger`・
`html-eslint`・`react-hooks`・tailwind）— msa に web app は無い。vendored な英語 docs への `textlint` + `yomiyasu`
— その文章は upstream のもの。`release-please`・`renovate`・`autofix.yml`・`up-to-date.yml`・`zap.yml`・
Cloudflare deploy job — msa はまだ何も publish せず、deploy 先も無い。`packages/**` への `fallow` と decision
plugin — 上の表のとおり。`.intent` の skill ゲート — まだ intent package が無い。

いずれも「忘れた」のではなく「今は採らない」決定で、msa が `apps/**` に app を持つ時や publish を始める時に、
fence の msa 側にだけ戻ってくる。
