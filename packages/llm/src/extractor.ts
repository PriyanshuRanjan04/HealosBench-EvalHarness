/**
 * extractor.ts
 *
 * Provider-agnostic extraction loop.
 *
 * Reads LLM_PROVIDER from env and instantiates the correct provider:
 *   LLM_PROVIDER=anthropic  →  AnthropicProvider (tool use + prompt caching)
 *   LLM_PROVIDER=groq       →  GroqProvider       (JSON mode, no caching)
 *
 * The retry loop, AJV validation, and public API are the same regardless
 * of provider. runner.service.ts and callers need zero changes.
 */

import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import type Anthropic from "@anthropic-ai/sdk";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { env } from "@test-evals/env/server";
import type { ExtractionSchema } from "@test-evals/shared";
import type { IPromptStrategy } from "./types.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { GroqProvider } from "./providers/groq.js";
import type { LLMProvider } from "./providers/types.js";

// ---------------------------------------------------------------------------
// AJV 2020-12 — compile once at module load
// ---------------------------------------------------------------------------

// ajv-formats v3 exports differ between CJS and ESM; handle both shapes
const _addFormats =
  typeof addFormats === "function"
    ? addFormats
    : (addFormats as { default: typeof addFormats }).default;

const ajv = new Ajv2020({ strict: false, allErrors: true });
_addFormats(ajv);

// ---------------------------------------------------------------------------
// Schema path — resolved relative to THIS file, not cwd.
//
// This file: packages/llm/src/extractor.ts
//   ../        → packages/llm/
//   ../../     → packages/
//   ../../../  → <monorepo root>
//   ../../../data/schema.json ✓
//
// Works in ALL invocation contexts:
//   bun run eval  (cwd = monorepo root)
//   bun run dev   (cwd = apps/server/ — would break process.cwd())
//   any IDE / test runner
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCHEMA_PATH = resolve(__dirname, "../../../data/schema.json");

// Strip $schema so AJV doesn't attempt to fetch/resolve the draft URI.
const _rawSchema = JSON.parse(
  readFileSync(SCHEMA_PATH, "utf8"),
) as Record<string, unknown>;
const { $schema: _discarded, ...extractionJsonSchema } = _rawSchema;

const validateExtraction = ajv.compile(extractionJsonSchema);


// ---------------------------------------------------------------------------
// Public types (unchanged — runner.service.ts depends on these)
// ---------------------------------------------------------------------------

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface Attempt {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response: Record<string, any>;
  validationErrors?: string[];
  success: boolean;
}

export interface ExtractResult {
  prediction: ExtractionSchema | null;
  attempts: number;
  trace: Attempt[];
  usage: TokenUsage;
}

// ---------------------------------------------------------------------------
// Provider factory — reads LLM_PROVIDER once at module load
// ---------------------------------------------------------------------------

let _provider: LLMProvider | null = null;

function getProvider(): LLMProvider {
  if (!_provider) {
    const providerName = env.LLM_PROVIDER ?? "anthropic";
    if (providerName === "groq") {
      console.log("[extractor] Using Groq provider (JSON mode)");
      _provider = new GroqProvider();
    } else {
      console.log("[extractor] Using Anthropic provider (tool use + prompt caching)");
      _provider = new AnthropicProvider();
    }
  }
  return _provider;
}

// ---------------------------------------------------------------------------
// Core extraction loop
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 3;

/**
 * Extract clinical data from a transcript using the selected LLM provider.
 * Retries up to MAX_ATTEMPTS times on validation failure.
 *
 * Public API is identical to the original — runner.service.ts is unaffected.
 */
export async function extract(
  transcript: string,
  strategy: IPromptStrategy,
  model: string,
): Promise<ExtractResult> {
  const provider = getProvider();
  const trace: Attempt[] = [];

  const usage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  // Build initial message list from strategy
  const messages: Anthropic.MessageParam[] = strategy.buildMessages(transcript);
  let prediction: ExtractionSchema | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Snapshot messages before the call (for trace)
    const requestSnapshot = {
      provider: env.LLM_PROVIDER ?? "anthropic",
      model,
      attempt,
      messages: JSON.parse(JSON.stringify(messages)) as unknown,
    };

    let providerResponse: Awaited<ReturnType<LLMProvider["call"]>>;

    try {
      providerResponse = await provider.call(transcript, strategy, model, messages);
    } catch (err) {
      trace.push({
        request: requestSnapshot as Record<string, unknown>,
        response: { error: String(err) },
        validationErrors: ["API error: " + String(err)],
        success: false,
      });
      break;
    }

    // Accumulate token usage
    usage.inputTokens += providerResponse.usage.inputTokens;
    usage.outputTokens += providerResponse.usage.outputTokens;
    usage.cacheReadTokens += providerResponse.usage.cacheReadTokens;
    usage.cacheWriteTokens += providerResponse.usage.cacheWriteTokens;

    // ── Case 1: model didn't call the tool / didn't return valid JSON ─────────
    if (!providerResponse.calledTool || providerResponse.toolInput === null) {
      trace.push({
        request: requestSnapshot as Record<string, unknown>,
        response: providerResponse.rawResponse,
        validationErrors: ["Model did not return a valid tool call or JSON object."],
        success: false,
      });

      if (attempt < MAX_ATTEMPTS) {
        // Append assistant response (as text) + correction request
        messages.push({
          role: "assistant",
          content: providerResponse.rawResponse.choices
            ? // Groq: extract text content
              (
                (providerResponse.rawResponse.choices as Array<{ message?: { content?: string } }>)[0]
                  ?.message?.content ?? ""
              )
            : // Anthropic: keep content blocks
              (providerResponse.content as unknown as string),
        });
        messages.push(provider.buildMissingToolMessage());
      }
      continue;
    }

    // ── Case 2: validate the extracted object ─────────────────────────────────
    const toolInput = providerResponse.toolInput;
    const valid = validateExtraction(toolInput);

    if (!valid) {
      const errors = (validateExtraction.errors ?? []).map(
        (e) => `${e.instancePath || "/"} ${e.message ?? "unknown error"}`,
      );

      trace.push({
        request: requestSnapshot as Record<string, unknown>,
        response: providerResponse.rawResponse,
        validationErrors: errors,
        success: false,
      });

      if (attempt < MAX_ATTEMPTS) {
        // For Anthropic: append assistant content blocks + tool_result correction
        // For Groq: append the raw text + plain user correction
        if (providerResponse.toolUseId) {
          // Anthropic path — content is blocks
          messages.push({ role: "assistant", content: providerResponse.content });
          messages.push(
            provider.buildValidationErrorMessage(providerResponse.toolUseId, errors),
          );
        } else {
          // Groq path — content is a string
          const rawText =
            (providerResponse.rawResponse.choices as Array<{ message?: { content?: string } }>)[0]
              ?.message?.content ?? "";
          messages.push({ role: "assistant", content: rawText });
          messages.push(provider.buildValidationErrorMessage("", errors));
        }
      }
      continue;
    }

    // ── Case 3: success ───────────────────────────────────────────────────────
    prediction = toolInput as unknown as ExtractionSchema;
    trace.push({
      request: requestSnapshot as Record<string, unknown>,
      response: providerResponse.rawResponse,
      success: true,
    });
    break;
  }

  return {
    prediction,
    attempts: trace.length,
    trace,
    usage,
  };
}
