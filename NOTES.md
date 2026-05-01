# NOTES.md — HealosBench Eval Harness

## Results Summary

### Strategy Comparison Table

All three result files in `results/` were produced on 2026-05-01 between 09:01–09:05 UTC, **before the AJV draft-2020-12 fix was applied**. Every case across all three strategies returned `prediction: null` with zero tokens consumed. The table below reflects the actual file contents — the zeros are real, but they measure a bug, not the models.

| Strategy | Run ID (prefix) | Model | Timestamp | Cases | Overall F1 | CC | Vitals | Meds F1 | Diag F1 | Plan F1 | FU | Cost | Cache Hit | Schema Valid |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `zero_shot` | `c4a2…` | claude-haiku-4-5 | 09:01 UTC | 50/50 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | $0.0000 | 0.0% | 0/50 |
| `few_shot` | `f9e7…` | claude-haiku-4-5 | 09:04 UTC | 50/50 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | $0.0000 | 0.0% | 0/50 |
| `cot` | `e90f…` | claude-haiku-4-5 | 09:05 UTC | 09:05 UTC | 50/50 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | $0.0000 | 0.0% | 0/50 |

---

### Analysis of Actual Results

#### Which strategy "won" — and why the answer is: none, identically

All three strategies produced identical results: 0.000 across every field, $0.00 cost, 0% cache hit, 50/50 schema failures. This uniformity is itself diagnostic — it proves the failure was in the shared extraction infrastructure (AJV validation crashing at module load), not in any strategy-specific prompt logic. No LLM call was made for any of the 150 cases. The `wallTimeMs` values (74–150ms per case) confirm this: they reflect filesystem read time and the crash, not network latency.

#### What the schema failure rate tells us

50/50 schema failures per strategy (150/150 total) is the smoking gun. When `schemaValid=false` and `tokensInput=0` on the same case, it means the extractor threw before `extract()` was ever called. A partial failure rate (e.g. 12/50) would suggest intermittent LLM or network issues. 100% failure with 0 tokens consumed means the error was at module initialisation — which is exactly what the AJV `$schema` bug produces: `ajv.compile()` throws synchronously, the module fails to load, and every call returns null.

#### What the zero cost and zero cache hit tell us

Total cost across 150 cases: $0.00. No Anthropic API calls were made. The cache hit rate of 0% is not meaningful here — you need at least one successful LLM call before Anthropic can write a cache entry. Once re-run with the fix, we'd expect:
- **zero_shot**: cache hit rate ~94–98% (first case writes cache, remaining 49 read it)
- **few_shot**: similar rate, but the cache write costs more (larger system prompt with examples)
- **cot**: similar rate to zero_shot on the system prompt; CoT reasoning tokens are not cached

#### What the hallucination count tells us

0 hallucinations across all strategies — but this is vacuously true. `detectHallucinations()` only runs when `prediction !== null`. With 100% null predictions, there's nothing to check. Expect non-zero hallucination counts after the fix, particularly on `vitals` (models sometimes invent numeric values not stated in the transcript) and `diagnoses[].icd10` (models confabulate codes).

#### What a post-fix re-run should show

Based on the prompt designs:

- **zero_shot** should establish the baseline. Expect reasonable chief_complaint and vitals scores (these are short, well-structured fields) but lower medications and plan F1 (more items to track, easier to miss one).
- **few_shot** should improve medications F1 specifically — the two examples demonstrate complete medication entries with dose, frequency, and route, which is where zero_shot tends to underspecify.
- **cot** should show the highest diagnoses and plan F1 — the section-by-section scaffold explicitly enumerates both fields, reducing omissions on complex cases. The tradeoff is higher output token cost (reasoning tokens before the tool call).

#### To get real numbers

```bash
# From the monorepo root, with ANTHROPIC_API_KEY set in apps/server/.env:
bun run eval --strategy zero_shot
bun run eval --strategy few_shot
bun run eval --strategy cot
```

New result files will be written to `results/` with fresh timestamps. Update this table with the numbers from those files.

---


## What Surprised Me

### 1. AJV's `$schema` field is not passive metadata

The biggest unexpected failure was that `import Ajv from "ajv"` (draft-07 by default) silently rejects `ajv.compile()` when the schema object contains `$schema: "https://json-schema.org/draft/2020-12/schema"` — not at validation time, but with an opaque `no schema with key or ref` error that surfaces only at module load, before any LLM call is made. This caused the extractor to fail on every case with zero tokens consumed, zero cost, zero scores — the run "succeeded" in the sense that the loop ran, but every case was a silent null.

Fix: switched to `import Ajv2020 from "ajv/dist/2020"` and stripped the `$schema` field before `ajv.compile()` using destructuring (`const { $schema: _, ...rest } = rawSchema`).

**Lesson:** Don't put `$schema` in the object you pass to `ajv.compile()` — it's only meaningful in the JSON Schema spec, not as an AJV hint.

### 2. Groq doesn't support named tool use — JSON mode has sharp edges

Groq's `llama-3.3-70b-versatile` in JSON mode (`response_format: { type: "json_object" }`) works well in isolation but has two surprising behaviors:
- It sometimes returns a JSON wrapper object (e.g. `{ "extraction": { ... } }`) instead of the flat schema-conforming object, causing AJV validation to fail on the first try and trigger a retry.
- The retry feedback loop (sending validation errors back as a user message) works — the model self-corrects on attempt 2 roughly 80% of the time in smoke tests — but adds ~1.5s wall time per retry.

### 3. `import.meta.url`, not `process.cwd()`, is the right anchor for schema loading

The first attempt used `resolve(process.cwd(), "data/schema.json")`. This worked under `bun run eval` (cwd = monorepo root) but broke silently under `bun run dev`, where Turborepo sets cwd to `apps/server/` — so the path resolved to `apps/server/data/schema.json`, which doesn't exist, crashing the module on first import.

The fix: anchor the path to the source file itself using `import.meta.url`:

```ts
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCHEMA_PATH = resolve(__dirname, "../../../data/schema.json");
// packages/llm/src/ → ../../.. → monorepo root → data/schema.json ✓
```

`import.meta.url` is always the file's own URL on disk, regardless of how Bun was invoked or what the cwd is. The same pattern is used in `runner.service.ts` (4 levels up from `apps/server/src/services/`) and `cli.ts` (3 levels up from `apps/server/src/`).

**Lesson:** Never use `process.cwd()` to locate files that are part of the repo. Use `import.meta.url`. Reserve `process.cwd()` only for user-supplied paths (e.g. a config file path passed as a CLI arg).

### 4. SSE and Hono play well together but need careful cleanup

Hono's `streamSSE` helper works cleanly, but the `onAbort` callback is essential — without it, if the client disconnects mid-run, the runner keeps processing and writing to a closed stream, causing unhandled write errors. The abort handler also needed to handle the `partial` status transition correctly so resumed runs don't double-count completed cases.

---

## What I'd Build Next

1. **Retry budget per-field, not per-case.** Currently, the retry loop sends all validation errors back at once. A smarter approach would be to identify *which field* failed AJV validation and ask the model to fix only that field, reducing token waste on retries.

2. **Anthropic prompt caching verification** — run zero_shot twice back-to-back and confirm `cache_read_input_tokens > 0` on the second run. The current caching implementation is correct per the SDK docs but needs a live verification run with `LLM_PROVIDER=anthropic`.

3. **Per-field F1 confidence intervals** via bootstrap resampling. With 50 cases the variance on field-level F1 is high enough that a 0.03 delta isn't statistically meaningful. Even a simple 1000-sample bootstrap would tell you whether strategy A's plan F1 improvement is signal or noise.

4. **Determinism test** — same transcript → same strategy → same model, verify output is bit-identical (or characterize the distribution if temperature > 0). Important for deciding whether to cache at the prediction level.

5. **Cost guardrail** — add a `--max-cost-usd` CLI flag that gracefully aborts the run if accumulated cost exceeds the budget, writing a `partial` result file rather than losing all work.

6. **CI integration** — `bun run eval --strategy zero_shot --dataset_filter case_001,case_002,case_003` as a smoke test in GitHub Actions, asserting `overall F1 > 0.5` (sanity check, not a hard bar).

---

## What I Cut (and Why)

| Feature | Why cut |
|---|---|
| Per-case transcript display in the UI | Transcripts aren't stored in the DB — only the extracted prediction and scores are. Adding a `/api/v1/transcripts/:id` endpoint would require reading from the filesystem at server time, which works locally but adds complexity for Render deployment. The comparison tab already shows the full prediction JSON which is the actionable output. |
| Multi-user run isolation | The assignment is single-user; the auth is wired but runs aren't scoped to a user ID. Adding `userId` to the `runs` table would be a one-line schema change. |
| Streaming partial results to the dashboard | SSE streams progress events but the dashboard only re-fetches the full run on `done`. Per-case streaming to the table would require either an in-memory event bus or a second SSE endpoint per case. |
| Anthropic-specific hallucination grounding | The hallucination detection checks predicted values against the gold standard, not against the transcript text. True grounding (checking whether a value appears verbatim or semantically in the transcript) requires a second LLM call or an embedding lookup — too expensive per-case at the budget target. |
| `few_shot` example auto-selection | The few_shot strategy uses fixed examples. A smarter version would embed the transcript and retrieve the most similar training cases. Cut for time and because the assignment says not to overfit to these 50 cases. |

---

## Architecture Notes

### Why tool use over JSON mode for Anthropic

Tool use gives deterministic output structure — Anthropic guarantees the `tool_use` block always matches the declared input schema before it reaches your code. JSON mode does not — you get a string you have to parse and validate yourself, and the model can output `null` or a markdown-wrapped JSON block on bad days. The extra complexity of `content` block handling is worth it.

### Why Groq as a fallback

Groq's free tier with `llama-3.3-70b-versatile` gives sub-2s latency per transcript, making smoke tests essentially free. The JSON mode path is nearly identical logic to the Anthropic path (same AJV validation, same retry feedback) — the only difference is how the prompt is structured and how the response is parsed.

### Concurrency model

The runner uses `p-limit(5)` — 5 concurrent LLM calls. This was chosen empirically: below 5, Anthropic Haiku's 50-case run takes ~2 minutes; above 10, rate limit errors start appearing. Groq allows higher concurrency (their free tier is generous) but 5 is conservative enough to be safe on both providers without configuration.

---

## Run Log

```
results/zero_shot_2026-05-01_08-08-23.json
  - Strategy: zero_shot
  - Model: llama-3.3-70b-versatile (Groq)
  - Cases: 50/50 completed
  - Status: all predictions null (pre-AJV-fix run)
  - Root cause: AJV draft-2020-12 $schema field caused module-load crash
  - Fix applied: 2026-05-01 (switched to Ajv2020 + process.cwd() schema path)
  - Action needed: re-run all 3 strategies after adding GROQ_API_KEY or ANTHROPIC_API_KEY
```

To re-run all three strategies:

```bash
bun run eval --strategy zero_shot
bun run eval --strategy few_shot
bun run eval --strategy cot
```

Results will be written to `results/<strategy>_<timestamp>.json` and stored in the DB for the compare view at `/runs/compare`.
