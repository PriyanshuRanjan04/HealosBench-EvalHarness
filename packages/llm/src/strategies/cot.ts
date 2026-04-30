import type Anthropic from "@anthropic-ai/sdk";
import type { IPromptStrategy } from "../types.js";

const SYSTEM_TEXT = `You are a clinical data extractor with strong analytical skills.

When given a doctor-patient transcript, follow this exact reasoning process BEFORE calling the tool:

1. **Chief Complaint** — Identify the patient's primary reason for the visit. Quote or paraphrase their words. Note if it is ambiguous.

2. **Vitals** — Scan for BP (format: NNN/NN), heart rate (bpm), temperature (°F), and SpO2 (%). Note which are present and which are absent.

3. **Medications** — List every medication mentioned (current, new, stopped, or modified). For each, identify name, dose, frequency, and route. Note where any of these are unstated.

4. **Diagnoses** — Identify stated or implied diagnoses. Assign ICD-10 codes only when you are confident; otherwise omit the field.

5. **Plan** — Extract each discrete action item from the plan (prescriptions, referrals, lifestyle changes, monitoring instructions, etc.). One action per array element.

6. **Follow-up** — Identify the follow-up interval in days and the stated reason. If no follow-up is mentioned, use null for both.

After completing your analysis section by section, call extract_clinical_data exactly once with your findings. Only extract what is explicitly stated — do not infer values not present in the transcript.`;

export class ChainOfThoughtStrategy implements IPromptStrategy {
  readonly name = "cot" as const;

  systemPrompt(): Anthropic.TextBlockParam[] {
    return [
      {
        type: "text",
        text: SYSTEM_TEXT,
        cache_control: { type: "ephemeral" },
      },
    ];
  }

  buildMessages(transcript: string): Anthropic.MessageParam[] {
    return [
      {
        role: "user",
        content:
          "Work through the transcript section by section as instructed, " +
          "then call extract_clinical_data with your findings.\n\n" +
          `<transcript>\n${transcript}\n</transcript>`,
      },
    ];
  }
}
