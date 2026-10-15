# slice 01 — toolchain の fence、upstream の接ぎ目、実測ベースライン

## 解禁される契約

どの設定がどのパスを支配するかが決まり文書化され、upstream の接ぎ目が固定され、vendored engine と house 規約の
strictness の差が実測されて保存される。以降の slice が機械的作業になるのは、これが成立している時だけ。無ければ
「テンプレートを採る」は実測約 374k LOC の書き換えを意味する。

## 接ぎ目

- `UPSTREAM.md` — 固定 commit と取り込み手順（vendoring 方針の唯一の持ち主）。
- `docs/toolchain-fence.md` — fence の表（msa のパスと vendored パス）と ratchet の規則。
- `tools/fence-counts.mjs` — strict フラグごとの error 数を測る。`--write` で保存。
- `tools/fence-counts.baseline.json` — 保存された数値。
- root `package.json` — `fence:counts` / `fence:check`。
- git remote `upstream` → `https://github.com/earendil-works/pi`。

## 手順

1. `git remote add upstream https://github.com/earendil-works/pi`（この spec を書いた回で実施済み）。
2. `UPSTREAM.md` を書く。固定 sha、`packages/**` だけ upstream から取り込む規則、取り込みコマンド。
3. `docs/toolchain-fence.md` を、実測値付きで書く。
4. `tools/fence-counts.mjs` を書く。フラグごとに、`tsconfig.json` を extend してそのフラグだけ足した一時
   tsconfig を作り、リポジトリの TypeScript を走らせて `error TS` を数える。`--write` で
   `baseline.json` を書き換え、それ以外は比較して、増えていれば non-zero で終わる。
5. root `package.json` に `fence:counts` / `fence:check` を足す。

## 人が実行・確認できるもの

```bash
cd ~/ghq/github.com/masseater/msa
npm ci --ignore-scripts
node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json   # 0 errors
npm run fence:counts                # フラグごとの表を出し、baseline.json を書き換える
npm run fence:check                 # 同じ測定。どれかが増えていれば失敗
git remote -v | grep upstream
git merge-base main upstream/main   # == main（msa の patch はまだ無い）
```

## グリーンを保つもの

- `tsc --noEmit -p tsconfig.json` = 0 errors。
- `node --import ./packages/coding-agent/src/experimental/source-resolver.ts packages/coding-agent/src/cli.ts --help` が exit 0。
- `npm run check`（biome + tsc）。
- `pi-test.sh --version`。

## 任せる判断

- `tools/` 内のスクリプトの言語と配置（slice 4 で `vp` タスクに昇格するまで、素の node スクリプトでよい）。
- 測るフラグの一覧（house の base が pi の base に足すフラグ一式）。
- `fence:check` を毎 push に回すか CI だけにするか。実測の所要時間を見て決め、fence 文書に記録する。

## この設計をひっくり返す feedback

- 「vendored コードにも house の `no-comments`・decision rule・全 oxlint category を課したい」と言われたら、
  この fence が間違いで、ladder 全体を決め直す。
- 「msa は npm に package を publish する」と言われたら、slice 02 の機構は削除ではなく移植になる。
