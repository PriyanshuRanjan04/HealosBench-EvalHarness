/**
 * providers/groq.ts
 *
 * Groq implementation of LLMProvider.
 *
 * Groq does not support Anthropic-style tool use. Instead we use:
 *   - JSON mode (response_format: { type: "json_object" })
 *   - A system prompt that instructs the model to return the exact
 *     ExtractionSchema JSON structure
 *   - AJV validation of the parsed response — same schema as the
 *     Anthropic extractor so scoring is identical
 *
 * Cache tokens are always 0 (Groq has no prompt caching).
 *
 * Good models for this task:
 *   - llama-3.3-70b-versatile  (best quality)
 *   - mixtral-8x7b-32768       (faster, lower cost)
 */

import Groq from "groq-sdk";
import type Anthropic from "@anthropic-ai/sdk";
import { env } from "@test-evals/env/server";
import type { IPromptStrategy } from "../types.js";
import type { LLMProvider, ProviderResponse } from "./types.js";

// Singleton client
let _client: Groq | null = null;
function getClient(): Groq {
  if (!_client) {
    const apiKey = env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error(
        "[groq provider] GROQ_API_KEY is not set. " +
          "Add it to apps/server/.env or switch LLM_PROVIDER=anthropic.",
      );
    }
    _client = new Groq({ apiKey });
  }
  return _client;
}

/**
 * The JSON schema description we inject into the system prompt so the
 * model knows exactly what structure to return.
 */
const JSON_SCHEMA_DESCRIPTION = `
Return ONLY a JSON object — no markdown, no explanation — matching this exact structure:

{
  "chief_complaint": "<string>",
  "vitals": {
    "bp": "<systolic/diastolic e.g. 128/82> | null",
    "hr": <integer bpm> | null,
    "temp_f": <number °F> | null,
    "spo2": <integer %> | null
  },
  "medications": [
    { "name": "<string>", "dose": "<string> | null", "frequency": "<string> | null", "route": "<string> | null" }
  ],
  "diagnoses": [
    { "description": "<string>", "icd10": "<e.g. J06.9> (optional)" }
  ],
  "plan": ["<action string>"],
  "follow_up": {
    "interval_days": <integer> | null,
    "reason": "<string> | null"
  }
}

Rules:
- Use null for any field not explicitly mentioned in the transcript.
- bp must match pattern: digits/digits (e.g. "128/82") or null.
- hr must be an integer or null.
- temp_f must be a number or null.
- spo2 must be an integer or null.
- plan is an array of strings.
- medications and diagnoses are arrays (may be empty []).
`.trim();

export class GroqProvider implements LLMProvider {
  async call(
    transcript: string,
    strategy: IPromptStrategy,
    model: string,
    messages: Anthropic.MessageParam[],
  ): Promise<ProviderResponse> {
    const client = getClient();

    // Build system prompt: strategy system + JSON schema instruction
    const strategySystem = strategy
      .systemPrompt()
      .map((b) => b.text)
      .join("\n\n");

    const systemContent = strategySystem + "\n\n" + JSON_SCHEMA_DESCRIPTION;

    // Convert Anthropic-shaped messages to Groq (OpenAI-compatible) format.
    // For Groq we only keep the user-visible content (skip tool_result turns).
    // Note: Groq.ChatCompletionMessageParam does not exist in v1.1.2 at the
    // namespace level — use an explicit inline shape instead.
    type GroqMessage = { role: "system" | "user" | "assistant"; content: string };
    const groqMessages: GroqMessage[] = messages
      .filter((m): m is { role: "user" | "assistant"; content: string } => {
        if (m.role !== "user" && m.role !== "assistant") return false;
        // Skip non-string content blocks (tool results, etc.)
        return typeof m.content === "string";
      })
      .map((m) => ({ role: m.role, content: m.content as string }));

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemContent },
        ...groqMessages,
      ],
      response_format: { type: "json_object" },
      max_tokens: 2048,
      temperature: 0,
    });

    const choice = response.choices[0];
    const rawText = choice?.message?.content ?? "";
    const usage = response.usage;

    let toolInput: unknown | null = null;
    let parseError: string | null = null;

    try {
      toolInput = JSON.parse(rawText);
    } catch (e) {
      parseError = `JSON parse error: ${String(e)}`;
    }

    // Adapt to the Anthropic ContentBlock shape the extractor expects
    // We synthesise a fake text block carrying the raw JSON text.
    const content: Anthropic.ContentBlock[] = [
      {
        type: "text",
        text: rawText,
        citations: [],
      } as unknown as Anthropic.ContentBlock,
    ];

    const rawResponse: Record<string, unknown> = {
      id: response.id,
      model: response.model,
      choices: response.choices,
      usage: response.usage,
    };

    return {
      rawResponse,
      content,
      toolInput: parseError ? null : toolInput,
      toolUseId: null, // Groq has no tool-use IDs
      calledTool: parseError === null && toolInput !== null,
      usage: {
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        cacheReadTokens: 0,  // Groq has no prompt caching
        cacheWriteTokens: 0,
      },
    };
  }

  buildMissingToolMessage(): Anthropic.MessageParam {
    return {
      role: "user",
      content:
        "Your previous response was not valid JSON matching the required schema. " +
        "Please respond with ONLY the JSON object as described.",
    };
  }

  buildValidationErrorMessage(
    _toolUseId: string,
    errors: string[],
  ): Anthropic.MessageParam {
    return {
      role: "user",
      content:
        "Your JSON response failed validation. Errors:\n- " +
        errors.join("\n- ") +
        "\n\nPlease respond with ONLY the corrected JSON object.",
    };
  }
}
