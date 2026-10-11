# Harness 0.2.1-alpha.2 source candidate

Target: official tag `dsh-v0.2.1-alpha.2`, commit `d743267388641bc76f17c45ce8b4c231aed1d32c`. Recorded as a `sourceCandidates` entry, not a `supportedHosts` target: no published npm cohort was installed or accepted.

## Host change adopted

0.2.1-alpha.2 removed `ctx.subagents.start()` and `startContinuable()` in favor of `startActivation()`, and renamed `drainContinuableChildren()` to `drainChildren()` (upgrade guide `v0.2.1-alpha.1/subagent-activations`). Before adaptation every member spawn failed: the delegation guard wrapped the now-absent `startContinuable`, so all runtime scenarios but `protocol-compatibility` ran with zero member requests.

- `startMemberContinuable` (`src/harness-compat.ts`) uses `startContinuable` where the host has it and otherwise `startActivation` with `delivery: 'parent'`, which keeps the retired continuable contract: the captain receives the settlement notice and the member gets the return-to-parent guidance. The activation is never disposed; team teardown releases members through `drainMemberChildren`.
- `drainMemberChildren` prefers `drainContinuableChildren` and falls back to `drainChildren`.
- The member delegation guard wraps only the creation methods the host actually has (`start`, `startContinuable`, `startActivation`).
- The stability fixture builds its nested-branch and sibling activations through whichever API the host exposes.

## Source verification

`scripts/harness-source-verify.mjs` ran the packed 0.1.23 artifact against a clean worktree of the exact tag (lib host/client and the darwin-arm64 system addon built from that checkout), with `--candidate-version 0.2.1-alpha.2`:

- `candidate-gate.json`: the host's real compatibility evaluator accepts the widened peers at runtime version `0.2.1-alpha.2`.
- `source-runtime-result.json`: all ten deterministic runtime scenarios pass (lifecycle, lifecycle-cold-restore, fallback, fallback-cold-restore, failure, captain-idle-wakeup, progressive-entry, web-approval, protocol-compatibility, stability) across a 289-package source cohort.

The plugin's own typecheck and the local `verify` steps pass, except `verify:release` and `verify:compatibility`, which fail identically before this change because the local development install links the host instead of pinning an exact supported target. Its listed `unverified` scope (published artifacts, npm/GitHub install, real providers, packaged Electron, other platforms) still applies.

Once 0.2.1-alpha.2 or a later build is published and accepted, move it from `sourceCandidates` into `supportedHosts` as described in [maintenance-workflow.md](../maintenance-workflow.md).
