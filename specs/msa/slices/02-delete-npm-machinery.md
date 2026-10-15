# slice 02 — npm の release 機構を削除する

## 解禁される契約

msa の成果物は 1 つ（ソースから build する CLI）だけになり、upstream のコミュニティ・release 機構は消える。
publish を前提にしたスクリプトも、`npm version --workspaces` を前提にした記述も木に残らない。

## 接ぎ目

削除するもの（いずれも fence 上は「pi の配布」であって engine の挙動ではない）:

- root `scripts/` — `publish.mjs`・`release.mjs`・`release-packages.mjs`・`release-notes.mjs`・
  `local-release.mjs`・`pack-packages.mjs`・`package-artifacts.mjs`（+`.test.mjs`）・`sync-versions.js`
  （+`.test.mjs`）・`publish-model-catalog.mjs`（+`.test.mjs`）・`publish-release-announcement.mjs`（+`.test.mjs`）・
  `generate-coding-agent-install-lock.mjs`・`diff-model-catalog.mjs`・`update-model-catalog-pin.mjs`
  （+`.test.mjs`）・`local-package-install.mjs`（+`.test.mjs`）・`use-local-packages.mjs`・`npm-command.mjs`・
  `npm-audit.mjs`・`check-lockfile-commit.mjs`・`check-package-install.mjs`・`check-pinned-deps.mjs`
  （+`.test.mjs`）・`check-runtime-deps.mjs`（+`.test.mjs`）・`check-ts-relative-imports.mjs`・`issues/`。
- `packages/coding-agent/install-lock/`、`flake.nix`、`flake.lock`、`nix/`。
- `.github/workflows/` — `approve-contributor.yml`・`issue-analysis.yml`・`issue-gate.yml`・
  `issue-triage-labels.yml`・`pr-gate.yml`・`remove-inprogress-on-close.yml`・`build-binaries.yml`・
  `publish-model-catalog.yml`・`nix.yml`・`npm-audit.yml`。加えて `.github/APPROVED_CONTRIBUTORS` と
  `.github/ISSUE_TEMPLATE/`。`ci.yml` は slice 05 が `verify.yml` に置き換えるまで残す。
- root `package.json` — 上を呼ぶ script（`publish*`・`pack:packages`・`release*`・`version:*`・`check:pinned-deps`・
  `check:runtime-deps`・`check:ts-imports`・`check:package-install`・`check:install-lock:coding-agent`・
  `prepublishOnly`）と、publish のためだけにある `packages/*/package.json` の `prepublishOnly` / `version`。

残すもの: `packages/*/src` と `packages/*/test` は無傷。`pi-test.sh`（と `.bat`/`.ps1` — masseater は Windows 機を
使うので安い）、`packages/tui/native/**`、`packages/ai/scripts/generate-models.ts`、
`packages/coding-agent/scripts/generate-schemas.ts`、`examples/extensions/**`（5 つは workspace member のまま。
`packages/coding-agent/test/extensions-discovery.test.ts` が `with-deps` に依存している）。

## 人が実行・確認できるもの

```bash
cd ~/ghq/github.com/masseater/msa
ls .github/workflows                      # ci.yml だけ
test ! -e packages/coding-agent/install-lock && echo install-lock-gone
test ! -e flake.nix && echo nix-gone
git grep -l 'prepublishOnly' -- ':!node_modules' | wc -l    # 0
npm ci --ignore-scripts
node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node --import ./packages/coding-agent/src/experimental/source-resolver.ts \
     packages/coding-agent/src/cli.ts --help > /dev/null && echo CLI-OK
npm run check                             # biome + tsc。slice 04 までのゲート
```

## グリーンを保つもの

`tsc --noEmit` = 0 errors、`npm run check`、ソースからの CLI、`pi-test.sh --version`。

## 任せる判断

- `version:*` を 1 つでも残すか（msa は publish しないので既定は全削除）。
- `scripts/check-entry-graphs.mjs` を残すか（純粋にファイルシステムを見るだけなので、削除済みファイルを
  参照していなければ残す）。

## この設計をひっくり返す feedback

- 「msa は npm CLI を出す」と言われたら、この slice は「release-please と `vp` 駆動の publish を 1 package に
  移植する」に変わり、ladder に release の枝が足される。
