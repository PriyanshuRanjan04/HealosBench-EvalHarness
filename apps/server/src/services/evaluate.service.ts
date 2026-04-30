/**
 * evaluate.service.ts
 *
 * Pure, side-effect-free scoring and hallucination-detection functions.
 * All fuzzy matching is implemented with a token-set ratio algorithm
 * (no external fuzzy library needed) so the logic is auditable and
 * the dependency footprint stays minimal.
 */

import type {
  ExtractionSchema,
  FieldScores,
  HallucinationFlag,
} from "@test-evals/shared";

// ============================================================
// §1  Internal fuzzy-matching primitives
// ============================================================

/** Remove punctuation, collapse whitespace, lowercase. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokenize a normalized string into a Set of unique words. */
function tokenSet(s: string): Set<string> {
  return new Set(normalize(s).split(" ").filter(Boolean));
}

/**
 * Token-set ratio — symmetric fuzzy similarity in [0, 1].
 *
 * Algorithm (mirrors rapidfuzz token_set_ratio):
 *   Let A, B be token sets of the two strings.
 *   intersection = A ∩ B
 *   sorted_intersection = sorted tokens of intersection joined
 *   r1 = ratio(sorted_intersection, sorted_intersection + rest_a)
 *   r2 = ratio(sorted_intersection, sorted_intersection + rest_b)
 *   r3 = ratio(sorted_intersection + rest_a, sorted_intersection + rest_b)
 *   return max(r1, r2, r3)
 *
 * The inner `ratio` is the standard 2*|LCS| / (|a|+|b|) Levenshtein ratio
 * approximated here with a fast character-bigram overlap.
 */
function tokenSetRatio(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;

  const ta = tokenSet(na);
  const tb = tokenSet(nb);

  const intersection = new Set([...ta].filter((t) => tb.has(t)));
  const restA = [...ta].filter((t) => !intersection.has(t)).sort().join(" ");
  const restB = [...tb].filter((t) => !intersection.has(t)).sort().join(" ");
  const inter = [...intersection].sort().join(" ");

  const s1 = inter;
  const s2 = [inter, restA].filter(Boolean).join(" ");
  const s3 = [inter, restB].filter(Boolean).join(" ");
  const s4 = [inter, restA, restB].filter(Boolean).join(" ");

  return Math.max(
    bigramRatio(s1, s2),
    bigramRatio(s1, s3),
    bigramRatio(s2, s4),
    bigramRatio(s3, s4),
  );
}

/**
 * Fast bigram-overlap ratio as a proxy for edit-distance similarity.
 * Good enough for clinical text where tokens are mostly whole words.
 */
function bigramRatio(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      m.set(bg, (m.get(bg) ?? 0) + 1);
    }
    return m;
  };

  const ba = bigrams(a);
  const bb = bigrams(b);
  let overlap = 0;
  for (const [bg, count] of ba) {
    overlap += Math.min(count, bb.get(bg) ?? 0);
  }
  const total = (a.length - 1) + (b.length - 1);
  return total === 0 ? 1 : (2 * overlap) / total;
}

/** Compute precision / recall / F1 from a count of matches, pred length, gold length. */
function prf(matches: number, predLen: number, goldLen: number) {
  const precision = predLen === 0 ? 0 : matches / predLen;
  const recall = goldLen === 0 ? (predLen === 0 ? 1 : 0) : matches / goldLen;
  const f1 =
    precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

// ============================================================
// §2  Individual field scorers
// ============================================================

/**
 * scoreChiefComplaint
 * Token-set ratio after normalize. Returns 0–1.
 */
export function scoreChiefComplaint(predicted: string, gold: string): number {
  return tokenSetRatio(predicted, gold);
}

// ---- Vitals ----

/** Normalize a BP string: remove spaces around the slash. */
function normalizeBp(bp: string): string {
  return bp.replace(/\s*\/\s*/, "/").trim();
}

/**
 * scoreVitals
 * Each sub-field scored 0 or 1 (temp_f has ±0.2 tolerance).
 * Returns arithmetic mean of the four sub-field scores.
 */
export function scoreVitals(
  predicted: ExtractionSchema["vitals"],
  gold: ExtractionSchema["vitals"],
): number {
  // bp
  let bpScore: number;
  if (predicted.bp === null && gold.bp === null) bpScore = 1;
  else if (predicted.bp === null || gold.bp === null) bpScore = 0;
  else bpScore = normalizeBp(predicted.bp) === normalizeBp(gold.bp) ? 1 : 0;

  // hr
  let hrScore: number;
  if (predicted.hr === null && gold.hr === null) hrScore = 1;
  else if (predicted.hr === null || gold.hr === null) hrScore = 0;
  else hrScore = predicted.hr === gold.hr ? 1 : 0;

  // temp_f
  let tempScore: number;
  if (predicted.temp_f === null && gold.temp_f === null) tempScore = 1;
  else if (predicted.temp_f === null || gold.temp_f === null) tempScore = 0;
  else tempScore = Math.abs(predicted.temp_f - gold.temp_f) <= 0.2 ? 1 : 0;

  // spo2
  let spo2Score: number;
  if (predicted.spo2 === null && gold.spo2 === null) spo2Score = 1;
  else if (predicted.spo2 === null || gold.spo2 === null) spo2Score = 0;
  else spo2Score = predicted.spo2 === gold.spo2 ? 1 : 0;

  return (bpScore + hrScore + tempScore + spo2Score) / 4;
}

// ---- Medications ----

/** Normalize a dose string: collapse whitespace around units ("10 mg" → "10mg"). */
function normalizeDose(dose: string | null): string {
  if (!dose) return "";
  return dose
    .toLowerCase()
    .replace(/\s+/g, "")   // "10 mg" → "10mg", "500 mcg" → "500mcg"
    .trim();
}

/** Remove trailing 's' for naive singularization ("tablets" → "tablet"). */
function normalizeMedName(name: string): string {
  return normalize(name).replace(/s\b/g, "");
}

/** Map common frequency abbreviations to a canonical form. */
const FREQ_MAP: [RegExp, string][] = [
  [/\b(bid|twice\s*(?:a\s*)?daily|twice\s*(?:a\s*)?day|2x\s*daily)\b/i, "bid"],
  [/\b(tid|three\s*times\s*(?:a\s*)?daily|three\s*times\s*(?:a\s*)?day|3x\s*daily)\b/i, "tid"],
  [/\b(qid|four\s*times\s*(?:a\s*)?daily|4x\s*daily)\b/i, "qid"],
  [/\b(qd|daily|once\s*(?:a\s*)?daily|once\s*(?:a\s*)?day|every\s*day)\b/i, "qd"],
  [/\b(prn|as\s*needed|when\s*needed)\b/i, "prn"],
  [/\b(qhs|at\s*bedtime|nightly|every\s*night)\b/i, "qhs"],
  [/\b(q\s*4\s*(?:hours?|hrs?))\b/i, "q4h"],
  [/\b(q\s*6\s*(?:hours?|hrs?))\b/i, "q6h"],
  [/\b(q\s*8\s*(?:hours?|hrs?))\b/i, "q8h"],
  [/\b(q\s*12\s*(?:hours?|hrs?))\b/i, "q12h"],
];

function normalizeFrequency(freq: string | null): string {
  if (!freq) return "";
  let s = freq.toLowerCase().trim();
  for (const [pattern, canonical] of FREQ_MAP) {
    if (pattern.test(s)) return canonical;
  }
  return normalize(s);
}

/** Returns true if two medication entries count as a match. */
function medsMatch(
  pred: ExtractionSchema["medications"][number],
  gold: ExtractionSchema["medications"][number],
): boolean {
  const nameScore = tokenSetRatio(normalizeMedName(pred.name), normalizeMedName(gold.name));
  if (nameScore <= 0.8) return false;

  const doseMatch = normalizeDose(pred.dose) === normalizeDose(gold.dose);
  const freqMatch = normalizeFrequency(pred.frequency) === normalizeFrequency(gold.frequency);

  // Require both dose and frequency to match (or both be empty/null)
  return doseMatch && freqMatch;
}

/**
 * scoreMedications
 * Set-based greedy matching (each gold item consumed at most once).
 */
export function scoreMedications(
  predicted: ExtractionSchema["medications"],
  gold: ExtractionSchema["medications"],
): { precision: number; recall: number; f1: number } {
  const usedGold = new Set<number>();
  let matches = 0;

  for (const pred of predicted) {
    for (let gi = 0; gi < gold.length; gi++) {
      if (!usedGold.has(gi) && medsMatch(pred, gold[gi]!)) {
        matches++;
        usedGold.add(gi);
        break;
      }
    }
  }

  return prf(matches, predicted.length, gold.length);
}

// ---- Diagnoses ----

/**
 * scoreDiagnoses
 * Fuzzy description match (threshold 0.75) + ICD-10 exact-match bonus.
 * The bonus is capped to 1.0 in the F1 calculation.
 */
export function scoreDiagnoses(
  predicted: ExtractionSchema["diagnoses"],
  gold: ExtractionSchema["diagnoses"],
): { precision: number; recall: number; f1: number } {
  const usedGold = new Set<number>();
  let matches = 0;

  for (const pred of predicted) {
    let bestScore = 0;
    let bestGi = -1;

    for (let gi = 0; gi < gold.length; gi++) {
      if (usedGold.has(gi)) continue;
      const descScore = tokenSetRatio(
        normalize(pred.description),
        normalize(gold[gi]!.description),
      );
      if (descScore > bestScore) {
        bestScore = descScore;
        bestGi = gi;
      }
    }

    if (bestGi !== -1 && bestScore > 0.75) {
      // Bonus: exact ICD-10 match
      const icdBonus =
        pred.icd10 && gold[bestGi]!.icd10 && pred.icd10 === gold[bestGi]!.icd10
          ? 0.1
          : 0;
      // We count the match (bonus tracked but capped to 1 for F1 purposes)
      void icdBonus; // bonus is informational — F1 treats it as a plain match
      matches++;
      usedGold.add(bestGi);
    }
  }

  return prf(matches, predicted.length, gold.length);
}

// ---- Plan ----

/**
 * scorePlan
 * Fuzzy match each predicted plan item against gold items, threshold 0.7.
 */
export function scorePlan(
  predicted: string[],
  gold: string[],
): { precision: number; recall: number; f1: number } {
  const usedGold = new Set<number>();
  let matches = 0;

  for (const pred of predicted) {
    for (let gi = 0; gi < gold.length; gi++) {
      if (!usedGold.has(gi) && tokenSetRatio(pred, gold[gi]!) > 0.7) {
        matches++;
        usedGold.add(gi);
        break;
      }
    }
  }

  return prf(matches, predicted.length, gold.length);
}

// ---- Follow-up ----

/**
 * scoreFollowUp
 * interval_days: exact match (both null → 1, mismatch → 0).
 * reason: fuzzy token-set ratio after normalize.
 * Returns average of the two sub-scores.
 */
export function scoreFollowUp(
  predicted: ExtractionSchema["follow_up"],
  gold: ExtractionSchema["follow_up"],
): number {
  // interval_days
  let daysScore: number;
  if (predicted.interval_days === null && gold.interval_days === null) daysScore = 1;
  else if (predicted.interval_days === null || gold.interval_days === null) daysScore = 0;
  else daysScore = predicted.interval_days === gold.interval_days ? 1 : 0;

  // reason
  let reasonScore: number;
  if (!predicted.reason && !gold.reason) reasonScore = 1;
  else if (!predicted.reason || !gold.reason) reasonScore = 0;
  else reasonScore = tokenSetRatio(predicted.reason, gold.reason);

  return (daysScore + reasonScore) / 2;
}

// ============================================================
// §3  Hallucination detection
// ============================================================

/**
 * Check whether a candidate value appears verbatim (substring) or
 * with high fuzzy similarity inside the transcript.
 */
function appearsInTranscript(value: string, transcriptNorm: string): boolean {
  const normValue = normalize(value);
  if (!normValue) return true; // empty string is trivially present

  // 1. Substring check (fastest)
  if (transcriptNorm.includes(normValue)) return true;

  // 2. Token-set ratio against a sliding window of the transcript.
  //    We don't need to check the whole transcript at once — we slide
  //    over chunks roughly the same length as the value to keep it fast.
  const tokens = transcriptNorm.split(" ");
  const valueTokenCount = normValue.split(" ").length;
  const windowSize = Math.max(valueTokenCount + 4, 10);

  for (let i = 0; i <= tokens.length - valueTokenCount; i++) {
    const window = tokens.slice(i, i + windowSize).join(" ");
    if (tokenSetRatio(normValue, window) > 0.85) return true;
  }

  return false;
}

/**
 * detectHallucinations
 *
 * Checks string values in:
 *   - chief_complaint
 *   - medication names
 *   - diagnosis descriptions
 *   - plan items
 *
 * Returns a HallucinationFlag for each value that cannot be traced
 * back to the transcript.
 */
export function detectHallucinations(
  prediction: ExtractionSchema,
  transcript: string,
): HallucinationFlag[] {
  const flags: HallucinationFlag[] = [];
  const transcriptNorm = normalize(transcript);

  const check = (field: string, value: string) => {
    if (!value.trim()) return;
    if (!appearsInTranscript(value, transcriptNorm)) {
      flags.push({
        field,
        value,
        reason: `"${value}" could not be found in the transcript (no substring or fuzzy match > 0.85)`,
      });
    }
  };

  // Chief complaint
  check("chief_complaint", prediction.chief_complaint);

  // Medication names
  prediction.medications.forEach((med, i) => {
    check(`medications[${i}].name`, med.name);
  });

  // Diagnosis descriptions
  prediction.diagnoses.forEach((dx, i) => {
    check(`diagnoses[${i}].description`, dx.description);
  });

  // Plan items
  prediction.plan.forEach((item, i) => {
    check(`plan[${i}]`, item);
  });

  return flags;
}

// ============================================================
// §4  Top-level evaluateCase
// ============================================================

/**
 * evaluateCase
 *
 * Runs all scorers and returns a FieldScores + HallucinationFlag[].
 * When prediction is null (parse/schema failure) every score is 0
 * and hallucinations is empty.
 */
export function evaluateCase(
  prediction: ExtractionSchema | null,
  gold: ExtractionSchema,
  transcript: string,
): { scores: FieldScores; hallucinations: HallucinationFlag[] } {
  if (prediction === null) {
    return {
      scores: {
        chief_complaint: 0,
        vitals: 0,
        medications: { precision: 0, recall: 0, f1: 0 },
        diagnoses: { precision: 0, recall: 0, f1: 0 },
        plan: { precision: 0, recall: 0, f1: 0 },
        follow_up: 0,
        overall: 0,
      },
      hallucinations: [],
    };
  }

  const chief_complaint = scoreChiefComplaint(
    prediction.chief_complaint,
    gold.chief_complaint,
  );
  const vitals = scoreVitals(prediction.vitals, gold.vitals);
  const medications = scoreMedications(prediction.medications, gold.medications);
  const diagnoses = scoreDiagnoses(prediction.diagnoses, gold.diagnoses);
  const plan = scorePlan(prediction.plan, gold.plan);
  const follow_up = scoreFollowUp(prediction.follow_up, gold.follow_up);

  // Overall: mean of six scalar scores
  const overall =
    (chief_complaint +
      vitals +
      medications.f1 +
      diagnoses.f1 +
      plan.f1 +
      follow_up) /
    6;

  const hallucinations = detectHallucinations(prediction, transcript);

  return {
    scores: {
      chief_complaint,
      vitals,
      medications,
      diagnoses,
      plan,
      follow_up,
      overall,
    },
    hallucinations,
  };
}
