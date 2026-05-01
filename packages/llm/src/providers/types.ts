/**
 * providers/types.ts
 *
 * Shared interface that every LLM provider must implement.
 * The extractor.ts retry loop calls provider.call() on each attempt
 * and uses the helper methods to build correction messages.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { IPromptStrategy } from "../types.js";

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from Anthropic prompt cache (0 for providers without caching). */
  cacheReadTokens: number;
  /** Tokens written into Anthropic prompt cache (0 for providers without caching). */
  cacheWriteTokens: number;
}

export interface ProviderResponse {
  /** Full raw response object for the trace. */
  rawResponse: Record<string, unknown>;
  /** Response content blocks (Anthropic-shaped; Groq adapts to this). */
  content: Anthropic.ContentBlock[];
  /** Parsed tool input object, or null if the model didn't call the tool. */
  toolInput: unknown | null;
  /** tool_use block id — needed to build correction messages (Anthropic only). */
  toolUseId: string | null;
  /** Whether the model actually called the tool in this attempt. */
  calledTool: boolean;
  usage: ProviderUsage;
}

export interface LLMProvider {
  /**
   * Make one LLM API call and return a normalised response.
   * `messages` is the current conversation history (mutated externally between attempts).
   */
  call(
    transcript: string,
    strategy: IPromptStrategy,
    model: string,
    messages: Anthropic.MessageParam[],
  ): Promise<ProviderResponse>;

  /** Build the message to append when the model skipped the tool call. */
  buildMissingToolMessage(): Anthropic.MessageParam;

  /** Build the correction message when AJV validation failed. */
  buildValidationErrorMessage(
    toolUseId: string,
    errors: string[],
  ): Anthropic.MessageParam;
}
