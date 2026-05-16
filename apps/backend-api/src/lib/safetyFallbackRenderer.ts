import type { ChatSourceCitation } from "@r3mes/shared-types";

import { buildAnswerPlan, type AnswerPlan } from "./answerPlan.js";
import type { AnswerSpec } from "./answerSpec.js";
import type { AnswerQualityFinding } from "./answerQualityValidator.js";
import type { ComposerInputConstraints } from "./composerInput.js";
import { composePlannedAnswer } from "./domainEvidenceComposer.js";
import type { EvidenceBundle } from "./evidenceBundle.js";
import { getDomainSafetyPolicy } from "./domainSafetyPolicy.js";
import type { SafetyFallbackMode } from "./safetyRailRegistry.js";
import { buildSafetyPresentationPolicy } from "./safetyPresentationPolicy.js";

export interface SafetyFallbackRenderInput {
  answerSpec: AnswerSpec;
  answerPlan?: AnswerPlan;
  evidenceBundle?: EvidenceBundle;
  sources: ChatSourceCitation[];
  fallbackMode: SafetyFallbackMode;
  qualityFindings?: AnswerQualityFinding[];
}

function sentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return /[.!?]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

function constraintsFor(plan: AnswerPlan): ComposerInputConstraints {
  return {
    forbidCaution: plan.constraints.forbidCaution,
    noRawTableDump: plan.constraints.noRawTableDump,
    maxWords: plan.constraints.maxWords,
    sourceGroundedOnly: plan.constraints.sourceGroundedOnly,
  };
}

function privacySafeFallback(): string {
  return "Bu yanıtta kullanılmak istenen kaynak kapsamı erişim sınırlarıyla uyuşmadığı için kaynaklı cevap verilmedi. Erişiminiz olan doğru collection'ı seçip tekrar deneyin.";
}

function sourceSuggestionFallback(): string {
  return "Seçili kaynaklarda bu soruya doğrudan yeterli bilgi bulamadım. Doğru collection'ı seçip tekrar deneyin veya ilgili belgeyi yükleyin.";
}

function lowGroundingSpec(spec: AnswerSpec, mode: SafetyFallbackMode): AnswerSpec {
  const policy = getDomainSafetyPolicy(spec.answerDomain);
  const assessment =
    mode === "domain_safe"
      ? "Eldeki kaynaklar bu soru için güvenli ve kesin bir yanıtı desteklemiyor."
      : "Eldeki kaynaklar bu soruya sınırlı dayanak sağlıyor.";
  return {
    ...spec,
    groundingConfidence: "low",
    tone: "cautious",
    assessment,
    action: spec.action || policy.fallbackGuidance.action,
    caution: spec.caution.length > 0 ? spec.caution : [policy.fallbackGuidance.caution],
    summary: spec.summary || policy.fallbackGuidance.summary,
  };
}

function conciseMissingFieldFallback(plan: AnswerPlan): string {
  const missing = plan.diagnostics.missingFieldIds;
  if (missing.length > 0) {
    return `Kaynakta sorulan alanlar için tam değer bulunamadı: ${missing.join(", ")}.`;
  }
  return "Kaynakta sorulan alan için doğrulanmış değer bulunamadı.";
}

export function renderSafetyFallback(input: SafetyFallbackRenderInput): string {
  if (input.fallbackMode === "source_suggestion") return sourceSuggestionFallback();
  if (input.fallbackMode === "privacy_safe") return privacySafeFallback();

  const answerPlan = input.answerPlan ?? buildAnswerPlan(input.answerSpec);
  const constraints = constraintsFor(answerPlan);
  const presentationPolicy = buildSafetyPresentationPolicy({
    answerPlan,
    constraints,
    blockingRail: input.fallbackMode === "domain_safe",
  });

  if (
    answerPlan.taskType === "field_extraction" &&
    !presentationPolicy.allowGenericCaution &&
    answerPlan.coverage !== "complete"
  ) {
    return conciseMissingFieldFallback(answerPlan);
  }

  const spec =
    input.fallbackMode === "low_grounding" && answerPlan.taskType === "field_extraction"
      ? input.answerSpec
      : lowGroundingSpec(input.answerSpec, input.fallbackMode);

  const rendered = composePlannedAnswer({
    answerSpec: spec,
    answerPlan,
    evidenceBundle: input.evidenceBundle,
    constraints,
  }).trim();

  if (rendered) return rendered;

  const policy = getDomainSafetyPolicy(input.answerSpec.answerDomain);
  if (presentationPolicy.allowGenericCaution) {
    return [
      sentence(policy.fallbackGuidance.caution),
      sentence(policy.fallbackGuidance.action),
      sentence(policy.fallbackGuidance.summary),
    ].join(" ");
  }
  return sentence(policy.fallbackGuidance.summary);
}
