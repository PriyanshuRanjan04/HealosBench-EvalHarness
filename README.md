# 🏥 HEALOSBENCH

### LLM Evaluation Harness for Structured Clinical Extraction

A production-grade evaluation system that benchmarks large language models on the task of turning unstructured doctor–patient transcripts into validated structured JSON. Built with Bun, Hono, Next.js, Drizzle ORM, and the Anthropic/Groq SDKs — complete with a live-streaming dashboard, per-field F1 scoring, hallucination detection, prompt caching, and fully resumable concurrent runs.

---

## ✨ What This Does

HealosBench runs three different prompting strategies (zero-shot, few-shot, chain-of-thought) against a dataset of 50 synthetic clinical transcripts, extracts structured JSON from each one using an LLM, and then scores every field of every prediction against a human-annotated gold standard. It stores everything in Postgres, exposes a Hono REST + SSE API, and renders a Next.js dashboard where you can watch runs stream in live, drill into per-case failures, and compare strategies head-to-head on a field-by-field delta table.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Runtime | [Bun](https://bun.sh) |
| Monorepo | [Turborepo](https://turbo.build) |
| API Server | [Hono](https://hono.dev) (deployed on Render) |
| Frontend | [Next.js 16](https://nextjs.org) App Router (deployed on Vercel) |
| Database | [Drizzle ORM](https://orm.drizzle.team) + PostgreSQL ([Neon](https://neon.tech) recommended) |
| Auth | [Better Auth](https://www.better-auth.com) (email + password) |
| LLM — Primary | [Anthropic Claude Haiku](https://anthropic.com) via Tool Use + Prompt Caching |
| LLM — Fallback | [Groq](https://console.groq.com) (llama-3.3-70b-versatile) via JSON Mode |
| Schema Validation | [AJV](https://ajv.js.org) (draft 2020-12) |
| UI Components | Radix UI + Tailwind CSS |
| Type Safety | TypeScript 5 across the entire monorepo |

---

## 📂 Project Structure

```
healosbench-eval-harness/
├── apps/
│   ├── server/               # Hono API: eval runs, SSE streaming, auth handler
│   └── web/                  # Next.js dashboard: runs list, detail, compare view
├── packages/
│   ├── llm/                  # Prompt strategies, Anthropic/Groq providers, AJV validation
│   ├── shared/               # TypeScript types shared by server + web
│   ├── db/                   # Drizzle schema, migrations, and DB client
│   ├── auth/                 # Better Auth config (email/password, cookie settings)
│   ├── env/                  # @t3-oss/env-core validated environment variables
│   ├── ui/                   # Shared Radix/Tailwind component library
│   └── config/               # Shared tsconfig.base.json
├── data/
│   ├── transcripts/          # 50 x case_NNN.txt  (synthetic doctor–patient transcripts)
│   ├── gold/                 # 50 x case_NNN.json (human-annotated gold extractions)
│   └── schema.json           # JSON Schema (draft 2020-12) all extractions must conform to
├── results/                  # CLI run output JSON files (auto-generated)
├── .env.example              # All environment variable documentation
├── render.yaml               # Render deployment config for apps/server
└── vercel.json               # Vercel deployment config for apps/web
```

---

## 🚀 Getting Started

### Prerequisites

- **Bun** ≥ 1.1 — [install](https://bun.sh/docs/installation)
- **PostgreSQL** — local, or free cloud via [Neon](https://neon.tech)
- **API key** — Anthropic (`sk-ant-…`) **or** Groq (`gsk_…`, free)

### Clone and Install

```bash
git clone https://github.com/your-username/healosbench-eval-harness.git
cd healosbench-eval-harness
bun install
```

### Environment Setup

Copy the example and fill in your values:

```bash
cp .env.example apps/server/.env
```

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string (`postgresql://user:pass@host:5432/db`) |
| `BETTER_AUTH_SECRET` | ✅ | Random ≥32-char string — `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | ✅ | URL of the Hono server (`http://localhost:8787` locally) |
| `CORS_ORIGIN` | ✅ | URL of the Next.js app (`http://localhost:3001` locally) |
| `LLM_PROVIDER` | ✅ | `"anthropic"` or `"groq"` |
| `ANTHROPIC_API_KEY` | if Anthropic | `sk-ant-…` from [console.anthropic.com](https://console.anthropic.com) |
| `GROQ_API_KEY` | if Groq | `gsk_…` from [console.groq.com](https://console.groq.com) (free) |

Create `apps/web/.env.local`:

```env
NEXT_PUBLIC_SERVER_URL=http://localhost:8787
```

### Database Setup

```bash
bun run db:push
```

### Run Locally

```bash
bun run dev          # starts Hono (:8787) + Next.js (:3001) concurrently
```

Open [http://localhost:3001](http://localhost:3001) — sign up at `/signup`, then you're in.

---

## 🎯 Running Evaluations

### CLI

```bash
# Run a single strategy (all 50 cases, concurrent)
bun run eval --strategy zero_shot
bun run eval --strategy few_shot
bun run eval --strategy cot

# Specify model explicitly
bun run eval --strategy zero_shot --model claude-haiku-4-5-20251001

# Run only a subset of cases
bun run eval --strategy cot --filter case_001,case_002,case_010
```

### What the Output Looks Like

```
[runner] startRun id=abc123 strategy=zero_shot model=claude-haiku-4-5-20251001 cases=50
[runner] 1/50 case_001 f1=0.847 cost=$0.00023
[runner] 2/50 case_002 f1=0.912 cost=$0.00018
...
[runner] Run abc123 COMPLETED
```

Results are written to `results/<strategy>_<timestamp>.json` and stored in Postgres for the dashboard.

### Via the API (HTTP trigger)

```bash
curl -X POST http://localhost:8787/api/v1/runs \
  -H "Content-Type: application/json" \
  -d '{"strategy":"cot","model":"claude-haiku-4-5-20251001"}'
# → { "runId": "abc123", "status": "running" }
```

---

## 🧠 Prompt Strategies

All three strategies use the same JSON Schema, tool definition, AJV validation, and retry logic. The only difference is the system prompt.

### `zero_shot`
A single concise instruction block: *"Extract structured data from the transcript using the tool. Only extract what is explicitly stated. Use null for missing fields."*

No examples, no reasoning scaffold. The model's prior knowledge of clinical documentation does all the work. Fastest and cheapest. Cache hit rate on repeated runs: ~100% (system prompt never changes between cases).

### `few_shot`
The same instruction block, followed by two complete worked examples in the system prompt — a migraine case and a diabetes follow-up. Each example shows the transcript and the exact JSON the tool call should produce.

The full instruction+examples block is cached as a single Anthropic cache slot. This means the first case in a run pays for the cache write, and all subsequent 49 cases pay only the much cheaper cache-read rate. Useful when the model is struggling with format fidelity.

### `cot` (Chain of Thought)
A structured reasoning scaffold that instructs the model to work through the transcript section by section — Chief Complaint → Vitals → Medications → Diagnoses → Plan → Follow-up — before making the tool call. The user message says "Work through the transcript section by section as instructed, then call `extract_clinical_data` with your findings."

This costs more output tokens (the model reasons explicitly before extracting) but tends to produce higher recall on complex cases with multiple medications or ambiguous diagnoses. The system prompt is cached; the reasoning appears in output tokens.

---

## 📊 Evaluation Metrics

Each field uses a metric matched to the structure of that field:

| Field | Metric | Why |
|---|---|---|
| `chief_complaint` | Token-set ratio (fuzzy, 0–1) | Free-text — allows paraphrasing ("chest tightness" ≈ "chest pain/tightness") |
| `vitals` | Mean of 4 sub-scores (0 or 1 each) | Structured values — BP exact, HR exact, temp_f ±0.2°F tolerance, SpO2 exact |
| `medications` | Precision / Recall / **F1** (set-based greedy match) | Order-invariant; name fuzzy (≥0.8 threshold) + dose and frequency exact |
| `diagnoses` | Precision / Recall / **F1** (fuzzy match ≥0.75) | ICD-10 bonus on exact code match; order-invariant |
| `plan` | Precision / Recall / **F1** (fuzzy match ≥0.7) | Bag-of-actions; order doesn't matter |
| `follow_up` | Mean of interval_days (exact) + reason (fuzzy) | Numeric field is binary; reason allows paraphrasing |
| `overall` | Arithmetic mean of all six scalar scores | Single headline number for run comparison |

**Hallucination detection:** each string value in the prediction is checked against the transcript text using a substring check + token-set sliding-window fuzzy match (threshold 0.85). Values that can't be found in the transcript are flagged as hallucinations.

---

## 📈 Results

| Strategy | Model | Overall F1 | Chief Complaint | Vitals | Medications F1 | Diagnoses F1 | Plan F1 | Follow-up | Cost | Cache Hit |
|---|---|---|---|---|---|---|---|---|---|---|
| `zero_shot` | claude-haiku-4-5 | — | — | — | — | — | — | — | — | — |
| `few_shot` | claude-haiku-4-5 | — | — | — | — | — | — | — | — | — |
| `cot` | claude-haiku-4-5 | — | — | — | — | — | — | — | — | — |

> Fill these in after running `bun run eval` for all three strategies. See `NOTES.md` for analysis.

---

## 🖥️ Dashboard

| Page | URL | Description |
|---|---|---|
| Runs list | `http://localhost:3001/` | Live table of all runs with status, F1 score bars, cost, and a "New Run" modal. Auto-refreshes every 10s. |
| Run detail | `http://localhost:3001/runs/:id` | Per-case expandable table. Live SSE progress bar while the run is active. Three tabs per case: Comparison (field-level colour-coded scoring), LLM Trace (token counts, wall time, retry count), Hallucinations. |
| Compare | `http://localhost:3001/runs/compare?a=:id&b=:id` | Side-by-side field delta table (green = A wins, red = B wins), win-count banner, stats cards, and a CSS-only bar chart. |
| Login | `http://localhost:3001/login` | Email + password sign-in (Better Auth). |
| Sign up | `http://localhost:3001/signup` | Create account. |

---

## 🤖 LLM Provider Support

Switch between providers with a single env var — no code changes needed.

```env
LLM_PROVIDER=groq      # free, JSON mode, fast — good for dev/smoke tests
LLM_PROVIDER=anthropic # tool use + prompt caching — required for final runs
```

| | Groq | Anthropic |
|---|---|---|
| Models | `llama-3.3-70b-versatile` | `claude-haiku-4-5-20251001` |
| Output enforcement | JSON mode + AJV validation | Tool use (`extract_clinical_data`) |
| Prompt caching | ❌ | ✅ (cache_control: ephemeral) |
| Cost | Free tier | ~$0.80/M input, $4/M output |
| Good for | Dev, smoke tests, CI | Final eval runs, caching verification |

**Groq note:** JSON mode can return wrapped objects (e.g. `{ "extraction": {...} }`) — the extractor detects and unwraps these automatically. If AJV validation fails, the validation errors are sent back to the model as a user message and it retries (up to 3 attempts per case).

---

## 🚢 Deployment

### Render (apps/server)

1. Connect repo to Render — it auto-detects `render.yaml`.
2. In Render dashboard → **Environment**, set:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon connection string |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | `https://your-app.onrender.com` |
| `CORS_ORIGIN` | `https://your-app.vercel.app` |
| `LLM_PROVIDER` | `anthropic` |
| `ANTHROPIC_API_KEY` | `sk-ant-…` |
| `GROQ_API_KEY` | `gsk_…` |

### Vercel (apps/web)

1. Import repo — Vercel auto-detects `vercel.json`.
2. Add one environment variable:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SERVER_URL` | `https://your-app.onrender.com` |

### Migrate production database

```bash
DATABASE_URL=postgresql://... bun run db:push
```

---

## 🏗️ Architecture Decisions

- **Tool use over JSON mode (Anthropic path):** Anthropic guarantees the `tool_use` content block always conforms to the declared input schema before it leaves the API. With raw JSON mode you get a string you must parse and validate yourself, and the model can produce markdown-wrapped JSON or nested objects on bad inputs. The AJV validation layer still runs as a belt-and-suspenders check, but tool use eliminates the most common failure modes.

- **Prompt caching:** Every strategy marks its system prompt block with `cache_control: { type: "ephemeral" }`. On a 50-case run, the first case writes the cache; all 49 subsequent cases pay the cache-read rate ($0.08/M vs $0.80/M for input), reducing system-prompt cost by ~90%.

- **Resumability:** `resumeRun()` queries `case_results` for all rows with `(run_id, schema_valid = true)`, computes the set difference against the full dataset, and runs only the remaining cases. A partial run caused by a crash, rate limit, or network failure can be resumed from the API or dashboard without re-running completed cases.

- **Idempotency:** Before calling the LLM for any case, `runCase()` checks whether a valid result already exists for `(run_id, transcript_id)`. If yes, it returns the cached DB row without making an API call. This makes it safe to retry a stuck run without double-billing.

- **Concurrency:** A hand-rolled `Semaphore(5)` limits concurrent LLM calls to 5 at a time. `Promise.all` over all cases ensures maximum throughput within that budget. The limit was chosen empirically — it saturates Anthropic Haiku's rate limit without triggering 429s under normal conditions. 429s that do occur are handled with exponential backoff (2s → 4s → 8s → 16s → 32s, max 5 retries).

---

## ⚠️ Known Limitations

| Limitation | Detail |
|---|---|
| Transcripts not stored in DB | The transcript text lives only on disk in `data/transcripts/`. The dashboard shows predictions and scores but cannot display the source transcript inline. |
| Hallucination detection is surface-level | Checked by substring + fuzzy match against the transcript — not a semantic/embedding check. A value that's clinically hallucinated but uses words from the transcript will be missed. |
| few_shot examples are static | The two few-shot examples are hardcoded. A retrieval-augmented approach (embedding the input transcript and finding the most similar training case) would likely improve recall on unusual presentations. |
| No per-user run scoping | Auth is wired but `runs` are not scoped to a user ID. All authenticated users see all runs. |
| Groq cache hit rate is always 0% | Groq does not support prompt caching. Cache hit rate will show 0% on Groq runs — this is expected. |
| Results table in README is empty | The zero_shot run in `results/` was produced before the AJV fix and has all-null predictions. Re-run all three strategies after configuring your API key to populate real numbers. |

---

## 📝 Notes

See [`NOTES.md`](./NOTES.md) for:
- Full results table (populated after runs)
- What surprised me during implementation
- What I'd build next
- What was cut and why
