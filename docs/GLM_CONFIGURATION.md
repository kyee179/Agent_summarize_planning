# GLM-4-Flash default and live bounded workflow

The bounded tool workflow from [Step 4](STEP_04.md) already replaced the single
completion. This update adds GLM as a native provider and makes `glm-4-flash` the
default model, preserving the same preview, validation, budget, and Apply gates.

## 1. Configure locally

```dotenv
AI_PROVIDER=glm
GLM_MODEL=glm-4-flash
GLM_API_KEY=your-local-key
```

The supplied credential is saved only in the project's ignored `.env`. This document
and `.env.example` contain no real key. Both API and development Electron launchers
load that explicit local file. An installed Electron app instead loads `.env` from
its userData directory, so this development configuration does not configure a
previously installed release. Restart running development app/API processes after
editing environment configuration. An inherited process environment takes precedence
over `.env`, as before.

## 2. Select the provider and report it accurately

`server/journalAnalyzer.cjs` adds GLM configuration, defaulting its model to exactly
`glm-4-flash`. The fixed base URL is `https://open.bigmodel.cn/api/paas/v4`.
Fresh store settings and the environment example select `glm`. Existing stored
preferences are preserved; a local `AI_PROVIDER=glm` overrides them.

Settings responses now report `effectiveAiProvider`, `aiModel`, and
`aiProviderOverride`, plus GLM's configured boolean. No key is returned. The UI
shows the effective model and disables provider selection while an environment
override is active, avoiding a displayed local provider with a remote provider
actually being used. Remove AI_PROVIDER from the local environment to select a
provider through the app. `AI_PROVIDER=local` keeps analysis offline.

## 3. Adapt the protocol

Zhipu's documented [endpoint and Bearer authentication](https://docs.bigmodel.cn/cn/api/introduction)
and [function-calling protocol](https://docs.bigmodel.cn/cn/guide/capabilities/function-calling)
are implemented in `server/agent/providers.cjs`.

GLM receives `max_tokens` (capped conservatively at 4095) and `tool_choice: auto`.
It does not receive OpenAI-only strict/parallel/max_completion_tokens parameters.
Only the four application function tools are supplied; no provider-hosted search
or extra tools are enabled. GLM tool replies use the existing call-ID correlation.

## 4. Handle live-model behavior within the same budget

The first live synthetic checks authenticated successfully but returned prose after
the first tool, failing the original tool-only protocol. This update pins policy
version **1.0.1**, preserving both skills at **1.0.0** and the previous policy file.
The new policy explicitly requires the full read/context/preview/finish sequence.

`createToolSession().nextInstruction()` derives the next step from workflow state.
GLM receives a fixed workflow-owned continuation message after each tool. If its
auto selection returns ordinary text, that text is never accepted as the final
analysis: the workflow allows a continuation retry, consuming the shared validation
error budget and a provider turn. The third validation/protocol error stops the
run. This cannot extend the 12-turn, 16-call, 60-second or data-size limits.

The live preview exceeded the former 15-second request cutoff. Individual requests
now have at most 30 seconds, capped by the remaining 60-second overall budget.
This accommodates the structured proposal without making total execution unbounded.

All calls still pass local schema and semantic validation. Multiple calls in one
reply remain rejected. Only finish_analysis with the latest successful preview ID
can produce a remote analysis result. Calendar writes still require user Apply.

## Verification

Synthetic tests cover GLM request parameters, bounded prose repair, required finish,
effective default selection, credential redaction, and settings overrides. The live
check uses a synthetic journal, no personal data, and no calendar/database writes.
Live authentication, read_evidence, and get_planning_context succeeded with HTTP
200 using the supplied key and exactly `glm-4-flash`. The structured preview did
not return within its 30-second request cutoff, including a streamed diagnostic
attempt; the workflow correctly aborted it and returned a validated local fallback.
**A complete live GLM planning run is not verified.** The adapter and state machine
pass synthetic protocol tests, but this provider's live preview latency remains an
operational limitation. These checks are not a summary-quality or estimate-accuracy
evaluation. Failures still produce explicit local-fallback metadata and cautions.
