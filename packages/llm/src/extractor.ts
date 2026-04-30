import Anthropic from "@anthropic-ai/sdk";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { env } from "@test-evals/env/server";
import type { ExtractionSchema } from "@test-evals/shared";
import { EXTRACT_TOOL_NAME, extractClinicalDataTool } from "./tool.js";
import type { IPromptStrategy } from "./types.js";

// ---------------------------------------------------------------------------
// AJV — compile once at module load for performance
// ---------------------------------------------------------------------------

// ajv-formats v3 exports differ between CJS and ESM; handle both shapes
const _addFormats =
  typeof addFormats === "function"
    ? addFormats
    : (addFormats as { default: typeof addFormats }).default;

const ajv = new Ajv({ strict: false, allErrors: true });
_addFormats(ajv);

/**
 * The JSON Schema for ExtractionSchema — inlined from data/schema.json.
 * We inline the relevant subset here rather than importing the file so
 * the package stays self-contained. The tool.ts input_schema is the
 * authoritative definition; this schema validates tool output.
 */
const extractionJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["chief_complaint", "vitals", "medications", "diagnoses", "plan", "follow_up"],
  properties: {
    chief_complaint: { type: "string", minLength: 1 },
    vitals: {
      type: "object",
      additionalProperties: false,
      required: ["bp", "hr", "temp_f", "spo2"],
      properties: {
        bp: { type: ["string", "null"], pattern: "^[0-9]{2,3}/[0-9]{2,3}$" },
        hr: { type: ["integer", "null"], minimum: 20, maximum: 250 },
        temp_f: { type: ["number", "null"], minimum: 90, maximum: 110 },
        spo2: { type: ["integer", "null"], minimum: 50, maximum: 100 },
      },
    },
    medications: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "dose", "frequency", "route"],
        properties: {
          name: { type: "string", minLength: 1 },
          dose: { type: ["string", "null"] },
          frequency: { type: ["string", "null"] },
          route: { type: ["string", "null"] },
        },
      },
    },
    diagnoses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description"],
        properties: {
          description: { type: "string", minLength: 1 },
          icd10: { type: "string", pattern: "^[A-Z][0-9]{2}(\\.[0-9A-Z]{1,4})?$" },
        },
      },
    },
    plan: { type: "array", items: { type: "string", minLength: 1 } },
    follow_up: {
      type: "object",
      additionalProperties: false,
      required: ["interval_days", "reason"],
      properties: {
        interval_days: { type: ["integer", "null"], minimum: 0, maximum: 730 },
        reason: { type: ["string", "null"] },
      },
    },
  },
};

const validateExtraction = ajv.compile(extractionJsonSchema);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface Attempt {
  /** Full request params sent to the Anthropic API */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request: Record<string, any>;
  /** Raw API response object */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response: Record<string, any>;
  /** AJV validation error messages, present only when validation failed */
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
// Anthropic client — singleton, created lazily
// ---------------------------------------------------------------------------

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Core extractor
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 3;

/**
 * Call the Anthropic API with the given strategy and transcript.
 * Retries up to MAX_ATTEMPTS times on validation failure, feeding errors
 * back as a user message to encourage self-correction.
 */
export async function extract(
  transcript: string,
  strategy: IPromptStrategy,
  model: string,
): Promise<ExtractResult> {
  const client = getClient();
  const trace: Attempt[] = [];

  // Accumulated token usage across all attempts
  const usage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  // Build the initial message list from the strategy
  const messages: Anthropic.MessageParam[] = strategy.buildMessages(transcript);

  let prediction: ExtractionSchema | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const requestParams: Anthropic.MessageCreateParams = {
      model,
      max_tokens: 4096,
      system: strategy.systemPrompt(),
      tools: [extractClinicalDataTool],
      // Force the model to call our tool on every attempt
      tool_choice: { type: "any" },
      messages,
    };

    // Record what we're sending (deep clone to snapshot the message list)
    const requestSnapshot = JSON.parse(JSON.stringify(requestParams)) as Record<string, unknown>;

    let response: Anthropic.Message;
    try {
      response = await client.messages.create(requestParams);
    } catch (err) {
      // Network / API error — record and bail out entirely
      const errRecord = {
        request: requestSnapshot,
        response: { error: String(err) },
        validationErrors: ["API error: " + String(err)],
        success: false,
      };
      trace.push(errRecord);
      break;
    }

    // Accumulate token counts
    const u = response.usage;
    usage.inputTokens += u.input_tokens;
    usage.outputTokens += u.output_tokens;
    // These fields exist when prompt caching is active
    usage.cacheReadTokens +=
      (u as Anthropic.Usage & { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
    usage.cacheWriteTokens +=
      (u as Anthropic.Usage & { cache_creation_input_tokens?: number })
        .cache_creation_input_tokens ?? 0;

    const responseRecord = { ...response } as Record<string, unknown>;

    // Find the tool_use block
    const toolUseBlock = response.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && b.name === EXTRACT_TOOL_NAME,
    );

    if (!toolUseBlock) {
      // Model responded without calling the tool — treat as failure
      const attemptRecord: Attempt = {
        request: requestSnapshot,
        response: responseRecord,
        validationErrors: ["Model did not call the extract_clinical_data tool."],
        success: false,
      };
      trace.push(attemptRecord);

      if (attempt < MAX_ATTEMPTS) {
        // Append the model's response turn and a correction request
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content:
            "You did not call the extract_clinical_data tool. " +
            "You MUST call it exactly once. Please try again.",
        });
      }
      continue;
    }

    // Validate the tool input against the JSON Schema
    const toolInput = toolUseBlock.input;
    const valid = validateExtraction(toolInput);

    if (!valid) {
      const errors = (validateExtraction.errors ?? []).map(
        (e) => `${e.instancePath || "/"} ${e.message ?? "unknown error"}`,
      );

      const attemptRecord: Attempt = {
        request: requestSnapshot,
        response: responseRecord,
        validationErrors: errors,
        success: false,
      };
      trace.push(attemptRecord);

      if (attempt < MAX_ATTEMPTS) {
        const errorSummary = errors.join("\n- ");
        // Feed the tool result back as a tool_result and add a correction request
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUseBlock.id,
              content:
                "Validation failed. Errors:\n- " +
                errorSummary +
                "\n\nPlease call extract_clinical_data again with corrected values.",
              is_error: true,
            },
          ],
        });
      }
      continue;
    }

    // Success
    prediction = toolInput as unknown as ExtractionSchema;
    trace.push({
      request: requestSnapshot,
      response: responseRecord,
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
