// Main extractor
export { extract } from "./extractor.js";
export type { ExtractResult, Attempt, TokenUsage } from "./extractor.js";

// Prompt hash utility
export { hashPrompt } from "./prompt-hash.js";

// Strategy interface
export type { IPromptStrategy } from "./types.js";

// Concrete strategy classes
export { ZeroShotStrategy } from "./strategies/zero-shot.js";
export { FewShotStrategy } from "./strategies/few-shot.js";
export { ChainOfThoughtStrategy } from "./strategies/cot.js";

// Tool definition (useful for building custom strategies or testing)
export { extractClinicalDataTool, EXTRACT_TOOL_NAME } from "./tool.js";
