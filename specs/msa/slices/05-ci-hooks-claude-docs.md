# slice 05 — ゲートを 1 本に: CI、hook、`.claude`、repo docs

## 解禁される契約

push も PR も `vp run verify` だけを走らせる。pre-push も同じタスクを回す。リポジトリ自身の agent hook と docs が
pi ではなく msa を語る。

## 接ぎ目

- `.github/workflows/verify.yml`（house テンプレートから）: `voidzero-dev/setup-vp` に `--frozen-lockfile`、
  push 時は `vp exec commitlint --from/--to`、`vp run --log grouped verify`、Vite Task の cache。
  定期実行が要るものが無ければ、workflow はこの 1 本だけ。
- `ci.yml`（置き換えられる側）と、残っている pi の workflow を削除。
- `.claude/settings.json`: `SessionStart`（install）、`PreToolUse`（`block-pnpm`・`fallow-gate`）、
  `Stop` = `vp run verify`。モデルを使う Stop agent 4 つと `cc-jev-teacher` marketplace は外す（web app の
  skill 一式を前提にしているため）。
- `AGENTS.md`: msa の規則 — fence、ゲートは `verify` ただ 1 つ、upstream 取り込み手順
  （`git fetch upstream && git merge upstream/main`、解決は `packages/**` の中でだけ、upstream のファイルを
  整形しない）、publish しない決定、msa のコードをどこに置くか。
- `README.md`: msa とは何か、セットアップのコマンド、公開先の一覧（今は空）。`CONTRIBUTING.md`（upstream の
  貢献者ガイド）は削除。`SECURITY.md` は本人が要る時だけ残す。
- `.gitignore`: `.env` を無視したまま、`specs/` と `tools/` が commit されることを確認する。

## 人が実行・確認できるもの

```bash
cd ~/ghq/github.com/masseater/msa
vp run verify
gh workflow list -R masseater/msa          # workflow は 1 本
git push origin <scratch-branch>           # CI グリーン。わざと壊した commit でレッドになること
```

## グリーンを保つもの

slice 04 のゲート、`vp check` の後に `git status` がきれい、`pi-test.sh --version`。

## 任せる判断

- `up-to-date.yml` 相当の workflow を残すか（house テンプレートにはあるが、PR を自動化するまで msa には不要）。
- `.claude` の hook の具体形。契約は「Stop が `vp run verify` を回す」ことだけで、ファイル一覧ではない。

## この設計をひっくり返す feedback

- 「PR ベースのレビュー工程（template・actionlint・zizmor）が欲しい」なら、それは後続の slice。pi の workflow 13 本を
  残す理由にはならない。
