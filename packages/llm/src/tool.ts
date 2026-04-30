/**
 * Shared Anthropic tool definition for extract_clinical_data.
 *
 * The input_schema is derived directly from data/schema.json.
 * Kept in one place so all three strategies use the identical tool;
 * any schema change propagates automatically.
 */
import type Anthropic from "@anthropic-ai/sdk";

export const EXTRACT_TOOL_NAME = "extract_clinical_data" as const;

export const extractClinicalDataTool: Anthropic.Tool = {
  name: EXTRACT_TOOL_NAME,
  description:
    "Extract structured clinical data from a doctor-patient encounter transcript. " +
    "Call this tool exactly once with all fields populated from the transcript. " +
    "Use null for any field that is not explicitly mentioned.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "chief_complaint",
      "vitals",
      "medications",
      "diagnoses",
      "plan",
      "follow_up",
    ],
    properties: {
      chief_complaint: {
        type: "string",
        minLength: 1,
        description:
          "The patient's primary reason for the visit, in their words or a brief clinical summary.",
      },
      vitals: {
        type: "object",
        additionalProperties: false,
        required: ["bp", "hr", "temp_f", "spo2"],
        properties: {
          bp: {
            type: ["string", "null"],
            pattern: "^[0-9]{2,3}/[0-9]{2,3}$",
            description: 'Blood pressure as systolic/diastolic mmHg, e.g. "128/82".',
          },
          hr: {
            type: ["integer", "null"],
            minimum: 20,
            maximum: 250,
            description: "Heart rate in beats per minute.",
          },
          temp_f: {
            type: ["number", "null"],
            minimum: 90,
            maximum: 110,
            description: "Temperature in degrees Fahrenheit.",
          },
          spo2: {
            type: ["integer", "null"],
            minimum: 50,
            maximum: 100,
            description: "Oxygen saturation, percent.",
          },
        },
      },
      medications: {
        type: "array",
        description:
          "Medications discussed (existing, started, stopped, or changed during this encounter).",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "dose", "frequency", "route"],
          properties: {
            name: { type: "string", minLength: 1 },
            dose: { type: ["string", "null"] },
            frequency: { type: ["string", "null"] },
            route: {
              type: ["string", "null"],
              description: "e.g. PO, IV, IM, topical, inhaled, SL, PR.",
            },
          },
        },
      },
      diagnoses: {
        type: "array",
        description: "Working or confirmed diagnoses for this encounter.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["description"],
          properties: {
            description: { type: "string", minLength: 1 },
            icd10: {
              type: "string",
              pattern: "^[A-Z][0-9]{2}(\\.[0-9A-Z]{1,4})?$",
              description: 'ICD-10-CM code, e.g. "J06.9" or "E11.9".',
            },
          },
        },
      },
      plan: {
        type: "array",
        description:
          "Plan items as concise free-text statements (one item per discrete action).",
        items: { type: "string", minLength: 1 },
      },
      follow_up: {
        type: "object",
        additionalProperties: false,
        required: ["interval_days", "reason"],
        properties: {
          interval_days: {
            type: ["integer", "null"],
            minimum: 0,
            maximum: 730,
          },
          reason: { type: ["string", "null"] },
        },
      },
    },
  },
};
