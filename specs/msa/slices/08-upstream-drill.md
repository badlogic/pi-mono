# slice 08 — upstream 取り込みの drill

## 解禁される契約

upstream の commit を取り込むのが、祈りではなく実測された手順になる。slice 07 の patch を入れた状態で実際に
merge を試し、衝突集合を記録して、Phase A は終わる。

## 接ぎ目

- `docs/upstream.md`: 手順（`git fetch upstream`、scratch branch で merge、解決は `packages/**` の中だけ、
  upstream のファイルを整形しない、`vp run verify` を回す）と、実測した衝突一覧、手を入れたファイルが衝突した
  時の扱い（その hunk は ours、他は upstream。構造的な patch だったなら引き直す）。
- 必要なら `.gitattributes` の merge driver を、drill 時点で最も新しい patch が入っているファイルに。
- `tools/upstream-status.mjs`: 固定 sha からの距離を出す（既定はオフライン、`--fetch` で更新）。

## 人が実行・確認できるもの

```bash
cd ~/ghq/github.com/masseater/msa
git fetch upstream
git switch -c drill/upstream-merge && git merge upstream/main
git diff --name-only --diff-filter=U          # この一覧を docs/upstream.md に記録する
git merge --abort && git switch main
node tools/upstream-status.mjs                # 固定 sha と upstream main の差
vp run verify                                 # main はグリーンのまま
```

## グリーンを保つもの

`main` の slice 07 のゲート。drill の branch は捨てる。

## 中止・作り直しの条件

衝突集合が最も手を入れている約 20 ファイルを含み、1 回の作業で解決できないなら、製品コードを足すのを止めて
vendoring の仕組みを変える（pinned snapshot + patch ディレクトリ、または upstream の各 release に rebase する
`msa/patches` branch）。そこで ladder を書き直す。

## 続きの probe（Phase B の最初の一歩。この slice には含まない）

orchestrator を作る前に、Claude Agent SDK のプロセスと pi の worker が同居できることを scratch ディレクトリで
確かめる: `claude -p "..." --output-format json`、および OpenAI 互換モデルに対する pi worker の実行（pi には
`packages/ai/src/providers/deepseek.ts` が既にあり、`packages/coding-agent/examples/extensions/subagent/` が
isolated な pi プロセスの起動例を既に持っている）。SDK が生きている間に pi を headless で駆動できないなら、
Phase B の前提が間違いなので、リポジトリに手を入れる前に ladder を引き直す。
