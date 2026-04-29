export type GroundingConfidence = "high" | "medium" | "low";
export type AnswerDomain = "medical" | "legal" | "finance" | "technical" | "education" | "general";
export type AnswerIntent = "reassure" | "triage" | "explain" | "steps" | "compare" | "unknown";

export interface GroundedMedicalAnswer {
  answer_domain: AnswerDomain;
  answer_intent: AnswerIntent;
  grounding_confidence: GroundingConfidence;
  user_query: string;
  answer: string;
  condition_context: string;
  safe_action: string;
  visit_triggers: string[];
  one_sentence_summary: string;
  general_assessment: string;
  recommended_action: string;
  doctor_visit_when: string[];
  red_flags: string[];
  avoid_inference: string[];
  short_summary: string;
  used_source_ids: string[];
}

export const EMPTY_GROUNDED_MEDICAL_ANSWER: GroundedMedicalAnswer = {
  answer_domain: "general",
  answer_intent: "unknown",
  grounding_confidence: "low",
  user_query: "",
  answer: "",
  condition_context: "",
  safe_action: "",
  visit_triggers: [],
  one_sentence_summary: "",
  general_assessment: "",
  recommended_action: "",
  doctor_visit_when: [],
  red_flags: [],
  avoid_inference: [],
  short_summary: "",
  used_source_ids: [],
};
