# DeepSeek Harness Alpha.4 compatibility

Validated on 2026-09-02 against the pinned harness at
`deepseek-harness@4e84901e64` (`@deepseek-ai/dsh@0.1.2-alpha.4`), macOS arm64,
Node.js 24.15.0. Starting plugin: 0.1.15 at official tip `232a338`
(built for Alpha.2). This is a **private fork patch** carried on
`later0day/dsh-agent-teams`, not a published release; the npm channel and
release metadata are unchanged.

## Cause and migration

Alpha.4 removed `ctx.subagents.registerContinuableSetup` (and the
`SubagentActivationSetupRegistry` behind it, harness commit `3091bdc257`). The
member selection runtime used that hook to install per-child listeners on each
fresh or cold-resumed continuable member. Booting the Alpha.2 plugin against an
Alpha.4 host crashes at load: `ctx.subagents.registerContinuableSetup is not a
function`.

The removed hook's per-child extension point is now the `agent/created`
lifecycle event: its payload carries the newly registered child `Agent`, and
`agent.ctx` is that child's agent-local Context — the exact scope the removed
setup callback received. This mirrors the harness's own migration of
`packages/experimental/tool-agent-team`, which replaced the same removed hook
with `ctx.on('agent/created', ({ agent }) => install(agent))`.

| Touchpoint | Change / verification |
| --- | --- |
| Member selection runtime | `installMemberSelectionRuntime` no longer calls `ctx.subagents.registerContinuableSetup`. It sweeps `ctx.agents.list()` once (cold-resume republish), then follows `agent/created`; per-child teardown follows `agent/disposed`, with a composite `ctx.effect` disposer. The per-child body — descriptor fold, member/team resolution, `installModelSelection` on `agent.ctx`, the `agent/error` failure-recovery listener and the `agent/request-error` fallback-switch listener — is unchanged, keyed by `payload.agent.id`. |
| Injection | `agents` was already declared in the plugin's `inject` list; no new capability dependency. |
| Model selection | Model route still flows to the child at spawn through `startContinuable` `request.agentOptions`; `installModelSelection(agent.ctx, …)` remains required to apply a live fallback switch to subsequent requests. |
| Verification | The nine-suite `pnpm verify` passes (fresh/cold model-selection routing, fallback switch, member-failure recovery, lifecycle, stress, web-routes, release-metadata, skill mirror). The plugin's hand-built ctx fakes were updated to model `agent/created` + `agent.ctx` in place of the removed hook. A real Alpha.4 host boots clean and serves `/plugins/dsh-agent-teams/state`; a headless-Chrome CDP run renders the app with zero console errors. |

The patch targets Alpha.4 only. Older RC/Alpha hosts, future harness releases,
Windows/Linux and alternative LLM providers are not claimed as validated.

## Verification

- `pnpm run build` — host `tsc` and client bundle clean.
- `pnpm run verify` — all nine suites green, exit 0.
- Real host boot on `:3080`: no `registerContinuableSetup` crash;
  `/plugins/dsh-agent-teams/state` returns 401 unauthenticated / 200 in the
  authenticated page; login gate and path-bypass fences intact.
