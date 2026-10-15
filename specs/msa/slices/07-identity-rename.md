# slice 07 — harness が msa を名乗る

## 解禁される契約

CLI が自称 `msa` になり、設定を `~/.msa` と `.msa/` に書く。ユーザーに見える文字列に pi が残らない。これが
msa 最初の *挙動* の変更で、意図的に小さくしてある。upstream のソースに手を入れて、その後も upstream を取り込める
ことを証明する（slice 08）。

## 接ぎ目

- `packages/coding-agent/src/config.ts` の `piConfig` → `{ name: "msa", configDir: ".msa" }`（upstream は
  `APP_NAME`・`<APP>_*` の env prefix・config ディレクトリをここで parameter 化済み）。
- bin 名（`dist/bundle/cli.js`・`bin.pi`）→ `msa`。help / version / error の文字列のうち `pi` を直書きしているもの。
- ソース起動の `pi-test.sh` → `scripts/msa-dev.sh`（仕組みは同じ: `--import` で source-resolver を読み、build 不要）。
- `PI_*` の env prefix をどうするか: upstream が `APP_NAME` から導出しているなら改名、していないならそのままにして
  理由を記録する。
- このリポジトリ自身の dotdir `.pi/` → `.msa/`（ユーザー設定ではなく repo の agent 設定）。

## 人が実行・確認できるもの

```bash
cd ~/ghq/github.com/masseater/msa
scripts/msa-dev.sh --version && scripts/msa-dev.sh --help | head -3     # msa と表示される
HOME=$(mktemp -d) scripts/msa-dev.sh -p "reply with ok"                 # <tmp>/.msa/ ができる
vp run verify
git grep -c '"\.pi' packages                                            # 報告する。0 でなくてもよい
```

## グリーンを保つもの

slice 06 のゲート、全 test、TUI が起動すること。

## 任せる判断

- package scope 改名（`@earendil-works/*` → publish 可能な scope）をここでやるか Phase B に送るか。既定は
  Phase B（最初の機能差分の直前）。1 回で済ませるため（`specs/msa/README.md`）。
- ユーザーに見える文字列のうちどれを改名し、どれを残すか（内部の型名とファイルパスは残す）。
