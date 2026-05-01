/**
 * providers/anthropic.ts
 *
 * Anthropic implementation of LLMProvider.
 *
 * - Uses tool use (extract_clinical_data) to enforce schema compliance
 * - Sets cache_control: { type: "ephemeral" } on system prompt blocks
 *   for prompt caching (saves ~90 % of input token cost on repeated runs)
 * - Returns cache_read_input_tokens + cache_creation_input_tokens so the
 *   runner can account for Anthropic's tiered pricing correctly
 *
 * This is the FULL production implementation required for the assignment.
 */

import Anthropic from "@anthropic-ai/sdk";
import { env } from "@test-evals/env/server";
import { EXTRACT_TOOL_NAME, extractClinicalDataTool } from "../tool.js";
import type { IPromptStrategy } from "../types.js";
import type { LLMProvider, ProviderResponse } from "./types.js";

// Singleton client — created once per process
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "[anthropic provider] ANTHROPIC_API_KEY is not set. " +
          "Add it to apps/server/.env or switch LLM_PROVIDER=groq.",
      );
    }
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export class AnthropicProvider implements LLMProvider {
  async call(
    transcript: string,
    strategy: IPromptStrategy,
    model: string,
    messages: Anthropic.MessageParam[],
  ): Promise<ProviderResponse> {
    const client = getClient();

    const requestParams: Anthropic.MessageCreateParams = {
      model,
      max_tokens: 4096,
      system: strategy.systemPrompt(), // already has cache_control on last block
      tools: [extractClinicalDataTool],
      tool_choice: { type: "any" }, // force tool call every attempt
      messages,
    };

    const response = await client.messages.create(requestParams);

    const u = response.usage;
    const usage = {
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens:
        (u as Anthropic.Usage & { cache_read_input_tokens?: number })
          .cache_read_input_tokens ?? 0,
      cacheWriteTokens:
        (u as Anthropic.Usage & { cache_creation_input_tokens?: number })
          .cache_creation_input_tokens ?? 0,
    };

    // Find the tool_use block
    const toolUseBlock = response.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && b.name === EXTRACT_TOOL_NAME,
    );

    return {
      rawResponse: response as unknown as Record<string, unknown>,
      content: response.content,
      toolInput: toolUseBlock?.input ?? null,
      toolUseId: toolUseBlock?.id ?? null,
      usage,
      calledTool: toolUseBlock !== undefined,
    };
  }

  /**
   * Build the correction message to append when tool call was missing.
   */
  buildMissingToolMessage(): Anthropic.MessageParam {
    return {
      role: "user",
      content:
        "You did not call the extract_clinical_data tool. " +
        "You MUST call it exactly once. Please try again.",
    };
  }

  /**
   * Build the correction message to append when validation failed.
   */
  buildValidationErrorMessage(
    toolUseId: string,
    errors: string[],
  ): Anthropic.MessageParam {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content:
            "Validation failed. Errors:\n- " +
            errors.join("\n- ") +
            "\n\nPlease call extract_clinical_data again with corrected values.",
          is_error: true,
        },
      ],
    };
  }
}
