/**
 * IPromptStrategy — interface every strategy must satisfy.
 *
 * Named IPromptStrategy (not PromptStrategy) to avoid shadowing the
 * PromptStrategy union type exported from @test-evals/shared.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { PromptStrategy } from "@test-evals/shared";

export interface IPromptStrategy {
  readonly name: PromptStrategy;
  /** Returns the system prompt blocks, with cache_control set on the last block. */
  systemPrompt(): Anthropic.TextBlockParam[];
  /** Builds the user-turn messages for a given transcript. */
  buildMessages(transcript: string): Anthropic.MessageParam[];
}
