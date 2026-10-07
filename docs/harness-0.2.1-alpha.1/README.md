# Harness 0.2.1-alpha.1 source candidate

Target: official tag `dsh-v0.2.1-alpha.1`, commit `5badb15009ae1756c3afe0ae0cef1faafc290ccc`. Recorded as a `sourceCandidates` entry, not a `supportedHosts` target: no published npm cohort was installed or accepted.

## Source verification

`scripts/harness-source-verify.mjs` ran the packed 0.1.22 artifact against a clean worktree of the exact tag (lib host/client and the darwin-arm64 system addon built from that checkout), with `--candidate-version 0.2.1-alpha.1`:

- `candidate-gate.json`: the host's real compatibility evaluator accepts the widened peers at runtime version `0.2.1-alpha.1`.
- `source-runtime-result.json`: all ten deterministic runtime scenarios pass (lifecycle, lifecycle-cold-restore, fallback, fallback-cold-restore, failure, captain-idle-wakeup, progressive-entry, web-approval, protocol-compatibility, stability) across a 280-package source cohort.

The plugin's own typecheck passes against this host. Its listed `unverified` scope (published artifacts, npm/GitHub install, real providers, packaged Electron, other platforms) still applies.

Once 0.2.1-alpha.1 or a later build is published and accepted, move it from `sourceCandidates` into `supportedHosts` as described in [maintenance-workflow.md](../maintenance-workflow.md).
