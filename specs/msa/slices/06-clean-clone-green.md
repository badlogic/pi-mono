# slice 06 — 他人の clone がグリーン

## 解禁される契約

`git clone` → 文書化されたコマンド 3 つ → グリーン。手作業の前提も、隠れた前工程も無い。今は生成物の有無で
typecheck の成否が変わる箇所があり、それを build の一部にする。

## 接ぎ目

- `packages/ai/scripts/generate-models.ts`（`--data-only`）を `vp` のタスクに組み込み、typecheck / test が
  それに依存するようにする。一度も走らせていない clone でも typecheck が通る状態にする。
- `packages/ai/src/providers/data/**`（約 1 MB、現在 gitignore）を commit するか生成するかを決めて記録する。
  既定は生成のまま（モデル catalog から導出されるもので、commit すると drift を招く）。安全にするのはタスクの
  依存順序の方。
- clean clone が要る他の生成入力（`packages/coding-agent/scripts/generate-schemas.ts`）も同じ扱い。
- root `README.md` のセットアップ節を、実際の 3 コマンドに合わせる。

## 人が実行・確認できるもの

```bash
git clone https://github.com/masseater/msa /tmp/msa-clean && cd /tmp/msa-clean
vp install --frozen-lockfile
vp run verify
node packages/coding-agent/dist/cli.js --help
```

## グリーンを保つもの

slice 05 のゲート。`npm run hydrate:model-data` は冪等のまま。`models.generated.ts` は生成物のまま
（手で編集しない）で、再生成後の diff が空か、upstream の catalog 更新として説明できること。

## 任せる判断

- タスクの依存順序で解決するか、生成物を commit するか（既定は前者）。
- `generate-models` を `build` に入れるか `verify` に入れるか（既定: build / typecheck の依存。test が
  ネットワークを要求しないようにする）。

## この設計をひっくり返す feedback

- CI の build がネットワークアクセスを必要とするのが許容できるかどうか。許容できないなら生成物を commit する。
