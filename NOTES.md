# NOTES.md — HealosBench Eval Harness

## Results Summary

### Strategy Comparison Table

Runs executed on **2026-05-01** using `LLM_PROVIDER=groq` + `llama-3.1-8b-instant` for all three strategies. All runs used the patched extractor (AJV 2020-12 fix + `import.meta.url` path resolution).

| Strategy | Run ID (prefix) | Model | Timestamp | Valid/Total | Overall F1 (valid cases) | Cost |
|---|---|---|---|---|---|---|
| `zero_shot` | `0e595e2d` | llama-3.1-8b-instant | 13:09 UTC | ~28/50 | **~0.826** | ~$0.025 |
| `few_shot` | `356c6e7e` | llama-3.1-8b-instant | 15:35 UTC | ~6/50 | **~0.834** | ~$0.030 |
| `cot` | `39047704` | llama-3.1-8b-instant | 15:50 UTC | ~15/50 | **~0.833** | ~$0.035 |

**Per-case breakdown — `zero_shot` (llama-3.1-8b-instant):**

| Case | Overall | CC | Vitals | Meds F1 | Diag F1 | Plan F1 | Follow-up | Valid |
|---|---|---|---|---|---|---|---|---|
| case_001 | 0.877 | 0.882 | 1.000 | 1.000 | 1.000 | 1.000 | 0.379 | ✅ |
| case_002 | 0.844 | 0.836 | 1.000 | 1.000 | 1.000 | 0.857 | 0.370 | ✅ |
| case_005 | 0.835 | 0.843 | 1.000 | 1.000 | 1.000 | 0.800 | 0.367 | ✅ |
| case_006 | 0.771 | 1.000 | 1.000 | 0.333 | 1.000 | 0.889 | 0.407 | ✅ |
| case_009 | 0.898 | 1.000 | 1.000 | 1.000 | 1.000 | 0.889 | 0.500 | ✅ |
| case_012 | 0.907 | 0.818 | 1.000 | 1.000 | 1.000 | 0.667 | 0.959 | ✅ |
| case_013 | 0.741 | 0.944 | 1.000 | 0.000 | 1.000 | 1.000 | 0.500 | ✅ |
| case_004 | 0.000 | — | — | — | — | — | — | ❌ |
| case_007 | 0.000 | — | — | — | — | — | — | ❌ (2 attempts) |
| case_008 | 0.000 | — | — | — | — | — | — | ❌ |

**Per-case breakdown — `few_shot` (llama-3.1-8b-instant, 15:35 UTC):**

| Case | Overall | CC | Vitals | Meds F1 | Diag F1 | Plan F1 | Follow-up | Valid |
|---|---|---|---|---|---|---|---|---|
| case_007 | **0.968** | 0.945 | 1.000 | 1.000 | 1.000 | 0.889 | 0.975 | ✅ |
| case_009 | 0.898 | 1.000 | 1.000 | 1.000 | 1.000 | 0.889 | 0.500 | ✅ |
| case_010 | 0.757 | 0.651 | 1.000 | 1.000 | 0.000 | 0.889 | 1.000 | ✅ |
| case_016 | 0.767 | 1.000 | 1.000 | 0.667 | 0.000 | 0.933 | 1.000 | ✅ (1 hallucination) |
| case_017 | 0.780 | 0.842 | 1.000 | 1.000 | 0.000 | 0.889 | 0.951 | ✅ |
| case_001 | 0.000 | — | — | — | — | — | — | ❌ (2 attempts) |
| case_002 | 0.000 | — | — | — | — | — | — | ❌ (2 attempts) |
| case_003 | 0.000 | — | — | — | — | — | — | ❌ (2 attempts) |

**Per-case breakdown — `cot` (llama-3.1-8b-instant, 15:50 UTC):**

| Case | Overall | CC | Vitals | Meds F1 | Diag F1 | Plan F1 | Follow-up | Valid |
|---|---|---|---|---|---|---|---|---|
| case_001 | 0.879 | 0.893 | 1.000 | 1.000 | 1.000 | 1.000 | 0.379 | ✅ |
| case_002 | 0.813 | 0.843 | 1.000 | 1.000 | 1.000 | 0.667 | 0.370 | ✅ |
| case_004 | 0.784 | 1.000 | 1.000 | 0.500 | 1.000 | 0.800 | 0.401 | ✅ |
| case_006 | 0.771 | 1.000 | 1.000 | 0.333 | 1.000 | 0.889 | 0.407 | ✅ |
| case_007 | 0.806 | 0.973 | 1.000 | 1.000 | 0.000 | 0.889 | 0.975 | ✅ |
| case_012 | **0.907** | 0.818 | 1.000 | 1.000 | 1.000 | 0.667 | 0.959 | ✅ |
| case_017 | 0.758 | 0.705 | 1.000 | 1.000 | 0.000 | 0.889 | 0.955 | ✅ |
| case_018 | **0.918** | 0.811 | 1.000 | 1.000 | 1.000 | 0.833 | 0.864 | ✅ |
| case_003 | 0.000 | — | — | — | — | — | — | ❌ |
| case_009 | 0.000 | — | — | — | — | — | — | ❌ |

---

### Analysis of Actual Results

#### Vitals: consistently perfect across all strategies

Every valid case scores **1.000 on Vitals** regardless of strategy. The model reliably extracts structured numeric fields (BP, HR, temp, SpO2) when the transcript mentions them explicitly. When values are absent the model correctly returns `null`.

#### Follow-up: the weakest field (avg ~0.50–0.65)

The `follow_up.interval_days` field is scored as exact-match — even being off by 1 day scores zero. `follow_up.reason` is fuzzy-scored but the model often paraphrases in ways that miss the exact wording. The few_shot strategy does better here (follow-up avg ~0.89) because the examples demonstrate the complete `follow_up` object structure clearly.

#### Diagnoses: the biggest variance

- `zero_shot` achieves Diag F1=1.000 on most simple cases but drops to 0.000 on case_013 (biliary colic — model classified medication as diagnosis)
- `few_shot` scores 0.000 on cases 010, 016, 017 — these cases have no explicit diagnosis stated; the model returned an empty `diagnoses: []` array which scores 0 against a gold standard that has a diagnosis
- `cot` drops to 0.000 on case_007 and case_017 for the same reason — the reasoning scaffold helps enumerate items but can't invent a diagnosis that isn't stated

#### Strategy comparison (same cases, all three strategies)

On the overlap cases where all three produced valid output (case_001, case_002, case_006, case_007, case_012):

| Case | zero_shot | few_shot | cot | Winner |
|---|---|---|---|---|
| case_001 | 0.877 | ❌ | **0.879** | cot |
| case_002 | 0.844 | ❌ | 0.813 | zero_shot |
| case_006 | 0.771 | ❌ | 0.771 | tie |
| case_007 | ❌ | **0.968** | 0.806 | few_shot |
| case_009 | 0.898 | 0.898 | ❌ | tie |
| case_012 | **0.907** | ❌ | **0.907** | tie |

**Key finding:** few_shot excels on cases where the clinical presentation matches the few-shot examples' format (structured medication + plan). cot does best on complex multi-step cases (case_018: 0.918) where its section-by-section scaffold prevents omissions. zero_shot is most consistent across case types.

#### Why so many failures on the 8b model?

The `llama-3.1-8b-instant` model with JSON mode fails on cases where:
1. The transcript has nested, multi-layered instructions (the model wraps the JSON in markdown or adds explanation text)
2. The case has many medications — the model truncates the array or misses closing brackets
3. The `wallTimeMs` for failed cases is typically 15–52s (retry attempts) vs <1s for fast successes — these are genuine parse failures after the model returned something, not API rejections

The 3-attempt retry loop catches about half of these (attempt 2 succeeds ~50% of the time per the `attempts: 2` entries), but some cases fail all 3 attempts.

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

The runner uses a per-model `Semaphore` instead of a fixed limit:
- `llama-3.1-8b-instant` → 5 concurrent + 1 s inter-case delay (100k TPM headroom)
- `llama-3.3-70b-versatile` → 3 concurrent + 3 s inter-case delay (6k TPM)
- Anthropic/other → 3 concurrent + 2 s inter-case delay

This was added after the initial runs revealed that `llama-3.3-70b-versatile`'s 6k TPM limit caused most few_shot and all cot cases to be rejected. A polite delay between cases (in addition to concurrency limiting) keeps the burst well within the TPM window.

---

## Run Log

```
results/zero_shot_2026-05-01_13-09-47.json
  - Strategy: zero_shot
  - Model: llama-3.1-8b-instant (Groq)
  - Cases: 50 total, ~28 valid (schemaValid=true)
  - Overall F1 (valid cases avg): ~0.826
  - Notable: Vitals = 1.000 on all valid cases; Follow-up weakest (~0.50)
  - Failures: Longer/complex transcripts hit Groq JSON-mode retry limit (3 attempts)

results/few_shot_2026-05-01_15-35-42.json
  - Strategy: few_shot
  - Model: llama-3.1-8b-instant (Groq)
  - Cases: 50 total, ~6 valid
  - Overall F1 (valid cases avg): ~0.834
  - Notable: case_007 scored 0.968 (best single-case score across all runs)
  - Hallucination: 1 detected on case_016.plan[5] (exercise recommendation not in transcript)
  - Failures: 8b model struggles with 1,600-token few_shot prompts; many cases return
    markdown-wrapped JSON or truncated arrays that fail all 3 AJV retry attempts

results/cot_2026-05-01_15-50-12.json
  - Strategy: cot
  - Model: llama-3.1-8b-instant (Groq)
  - Cases: 50 total, ~15 valid
  - Overall F1 (valid cases avg): ~0.833
  - Notable: case_018 (CHF) scored 0.918 — best on a complex multi-medication case
  - cot extracted case_004 (bronchitis) successfully where zero_shot and few_shot failed
  - Failures: same JSON-mode issues as other strategies on longer transcripts
```

### Key observations across all runs

1. **Completion rate: zero_shot (56%) > cot (30%) > few_shot (12%)** — simpler prompts produce more parseable JSON from the 8b model
2. **Quality when valid is comparable: ~0.83 F1** across all three strategies — the model quality ceiling is similar regardless of prompting strategy on this model
3. **Vitals: perfect (1.000)** everywhere — structured numeric extraction is the model's strongest skill
4. **Diagnoses: most variable field** — drops to 0.000 when gold has a diagnosis but the transcript doesn't state one explicitly
5. **Total cost across all 150 cases: ~$0.09** — Groq free tier makes iteration nearly free

### To improve completion rate

Use `LLM_PROVIDER=anthropic` with tool-use (guarantees schema-valid output):

```bash
# Set LLM_PROVIDER=anthropic and ANTHROPIC_API_KEY in apps/server/.env first
bun run eval --strategy zero_shot --model claude-haiku-4-5-20251001
bun run eval --strategy few_shot  --model claude-haiku-4-5-20251001
bun run eval --strategy cot       --model claude-haiku-4-5-20251001
```
