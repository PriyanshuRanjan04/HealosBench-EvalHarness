import { createHash } from "crypto";
import type { IPromptStrategy } from "./types.js";

/**
 * Returns the first 12 hex chars of the SHA-256 hash of the strategy's
 * system prompt content + strategy name.
 *
 * Any change to a single character in the prompt yields a different hash,
 * making it safe to use as a cache-busting key in the runs table.
 */
export function hashPrompt(strategy: IPromptStrategy): string {
  const blocks = strategy.systemPrompt();

  // Serialize deterministically: strategy name + every text block joined
  const payload = JSON.stringify({
    name: strategy.name,
    blocks: blocks.map((b) => b.text),
  });

  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 12);
}
