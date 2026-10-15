# upstream

msa は [earendil-works/pi](https://github.com/earendil-works/pi)（MIT）の fork。fork したのは pi の中身に手を
入れられるようにするため。vendoring の方針を決めるのはこのファイルだけ。

## 固定している base

```
4a5d37291531ad48b8e536c892557877d219463c
```

この commit の時点で `git merge-base main upstream/main` は `main` と一致していた。これ以降が msa のもの。

## 何を取り込み、何を取り込まないか

| パス | 方向 |
| --- | --- |
| `packages/**`（pi の engine: ai・agent・chord・codemode・coding-agent・durable・env・evals・mcp・telemetry・tui） | `upstream/main` から取り込む。msa の patch もここに入るので、小さく、遅く、少なく保つ。 |
| `specs/**`, `docs/**`, `tools/**`, `apps/**`, `libs/**`, `infra/**`, root の設定（`package.json`・`pnpm-workspace.yaml`・`tsconfig.base.json`・`vite.config.ts`・lint 設定）、`.github/**`, `.claude/**`, `AGENTS.md`, `UPSTREAM.md` | msa 専用。upstream に対応物が無いので衝突しない。 |
| `scripts/**`, `test.sh`, `pi-test.sh`, `.pi/**` | 混在。upstream が持ち主だが、msa 側は削除か 1 行変更に留めて衝突を減らす。 |
| `README.md`, `CONTRIBUTING.md`, `AGENTS.md` | msa の文章。upstream 側の変更は merge 時に捨てる。 |

規則: msa の流儀に合わせるためだけに `packages/**` のファイルを整形・再構成しない。vendored ファイルは
upstream の整形のまま（`docs/toolchain-fence.md` の fence）。一番手を入れているファイルほど、整形すると
以降の upstream 変更が必ず衝突する。

## 手順

```sh
git fetch upstream
git switch -c upstream/$(date +%Y%m%d)
git merge upstream/main
```

1. 衝突の解決は `packages/**` の中だけで行う。msa が意図的に入れた hunk 以外は upstream を取る（その hunk は
   ours を残し、構造的な patch なら引き直す）。
2. upstream の root 設定・workflow・docs は取らない。
3. ゲートを回す: `vp run verify`（slice 5 までは `npm run check` と `npm test`）。
4. `main` に merge し、このファイルの固定 commit を更新する。

## 状態

固定 base からの距離は `node tools/fence-counts.mjs` では分からない。slice 8 で upstream-status tool が入るまで
sha を手で比べる。
