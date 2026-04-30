import type Anthropic from "@anthropic-ai/sdk";
import type { IPromptStrategy } from "../types.js";

// ---------------------------------------------------------------------------
// Synthetic few-shot examples
// ---------------------------------------------------------------------------

const EXAMPLE_1_TRANSCRIPT = `
Dr. Ellis: Good morning, Ms. Carter. What brings you in today?
Patient: I've been having this really bad headache for three days now. It's behind my eyes and gets worse when I move around.
Dr. Ellis: Any fever, nausea, or changes in vision?
Patient: A little nausea, no fever. My vision seems fine.
Dr. Ellis: Let me check your vitals. BP is 138/88, heart rate 76, temperature 98.6, O2 sat 99%.
Patient: I take ibuprofen 400 mg by mouth twice a day but it barely helps.
Dr. Ellis: Given the duration and character, this looks like a migraine without aura. I'm going to start you on sumatriptan 50 mg orally as needed and refer you to neurology.
Patient: How soon should I come back?
Dr. Ellis: Let's follow up in two weeks if the sumatriptan isn't giving you relief.
`.trim();

const EXAMPLE_1_OUTPUT = JSON.stringify(
  {
    chief_complaint: "Headache for three days, worse with movement, behind the eyes",
    vitals: { bp: "138/88", hr: 76, temp_f: 98.6, spo2: 99 },
    medications: [
      { name: "Ibuprofen", dose: "400 mg", frequency: "twice daily", route: "PO" },
      { name: "Sumatriptan", dose: "50 mg", frequency: "as needed", route: "PO" },
    ],
    diagnoses: [{ description: "Migraine without aura", icd10: "G43.009" }],
    plan: [
      "Start sumatriptan 50 mg PO as needed for acute migraine attacks",
      "Refer to neurology",
      "Continue ibuprofen as bridge therapy",
    ],
    follow_up: { interval_days: 14, reason: "Assess response to sumatriptan" },
  },
  null,
  2,
);

const EXAMPLE_2_TRANSCRIPT = `
Dr. Patel: Hello Mr. Singh, I see you're here for your diabetes follow-up.
Patient: Yes, my sugar has been running high — around 220 fasting most mornings.
Dr. Patel: Let's check you over. Vitals: blood pressure 142/90, pulse 84, temp 98.2 Fahrenheit, sats 97%.
Patient: I'm on metformin 1000 mg twice a day with food.
Dr. Patel: Your HbA1c came back at 8.9%, which is above target. I'm going to add glipizide 5 mg orally before breakfast and increase your monitoring to twice daily. Also, I want you to start a low-carb diet.
Patient: When do I need to come back?
Dr. Patel: In 30 days to recheck fasting glucose and assess for side effects.
`.trim();

const EXAMPLE_2_OUTPUT = JSON.stringify(
  {
    chief_complaint: "Diabetes follow-up; fasting blood glucose ~220 mg/dL",
    vitals: { bp: "142/90", hr: 84, temp_f: 98.2, spo2: 97 },
    medications: [
      { name: "Metformin", dose: "1000 mg", frequency: "twice daily with food", route: "PO" },
      { name: "Glipizide", dose: "5 mg", frequency: "once daily before breakfast", route: "PO" },
    ],
    diagnoses: [{ description: "Type 2 diabetes mellitus, uncontrolled", icd10: "E11.9" }],
    plan: [
      "Add glipizide 5 mg PO before breakfast",
      "Increase blood glucose monitoring to twice daily",
      "Start low-carbohydrate diet",
      "Recheck HbA1c in 3 months",
    ],
    follow_up: { interval_days: 30, reason: "Recheck fasting glucose and assess for side effects" },
  },
  null,
  2,
);

// ---------------------------------------------------------------------------
// System prompt — instruction block + cached examples block
// ---------------------------------------------------------------------------

const INSTRUCTION_TEXT =
  "You are a clinical data extractor. Extract structured data from the transcript " +
  "using the extract_clinical_data tool. Be precise — only extract what is " +
  "explicitly stated in the transcript. Do not infer, assume, or hallucinate values. " +
  "Use null for any field that is not mentioned.\n\n" +
  "Below are two complete examples showing correct extraction behavior.";

const EXAMPLES_TEXT =
  `--- EXAMPLE 1 ---\n\nTranscript:\n${EXAMPLE_1_TRANSCRIPT}\n\nCorrect tool call input:\n${EXAMPLE_1_OUTPUT}` +
  `\n\n--- EXAMPLE 2 ---\n\nTranscript:\n${EXAMPLE_2_TRANSCRIPT}\n\nCorrect tool call input:\n${EXAMPLE_2_OUTPUT}`;

export class FewShotStrategy implements IPromptStrategy {
  readonly name = "few_shot" as const;

  systemPrompt(): Anthropic.TextBlockParam[] {
    // Both blocks are returned as a single cached block so the full
    // instruction + examples payload is cached together in one cache slot.
    return [
      {
        type: "text",
        text: `${INSTRUCTION_TEXT}\n\n${EXAMPLES_TEXT}`,
        // Critical: cache the whole block including examples so repeated
        // runs across many transcripts don't pay for the example tokens.
        cache_control: { type: "ephemeral" },
      },
    ];
  }

  buildMessages(transcript: string): Anthropic.MessageParam[] {
    return [
      {
        role: "user",
        content: `Now extract the clinical data from the following transcript:\n\n<transcript>\n${transcript}\n</transcript>`,
      },
    ];
  }
}
