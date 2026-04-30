import type Anthropic from "@anthropic-ai/sdk";
import type { IPromptStrategy } from "../types.js";

const SYSTEM_TEXT =
  "You are a clinical data extractor. Extract structured data from the transcript " +
  "using the extract_clinical_data tool. Be precise — only extract what is " +
  "explicitly stated in the transcript. Do not infer, assume, or hallucinate values. " +
  "Use null for any field that is not mentioned.";

export class ZeroShotStrategy implements IPromptStrategy {
  readonly name = "zero_shot" as const;

  systemPrompt(): Anthropic.TextBlockParam[] {
    return [
      {
        type: "text",
        text: SYSTEM_TEXT,
        // Cache the system prompt — saves input tokens on repeated calls
        cache_control: { type: "ephemeral" },
      },
    ];
  }

  buildMessages(transcript: string): Anthropic.MessageParam[] {
    return [
      {
        role: "user",
        content: `Please extract the clinical data from the following transcript:\n\n<transcript>\n${transcript}\n</transcript>`,
      },
    ];
  }
}
