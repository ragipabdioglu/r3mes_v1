import type { RuntimeProfileName } from "@r3mes/shared-types";

import { resolveRuntimeProfile } from "./runtimeProfile.js";

export type { RuntimeProfile, RuntimeProfileName, RuntimeStrictness } from "@r3mes/shared-types";
export { resolveRuntimeProfile } from "./runtimeProfile.js";

export interface RuntimeFallbackPolicy {
  profileName: RuntimeProfileName;
  allowDeterministicEmbeddingFallback: boolean;
  allowLightweightRerankerFallback: boolean;
  allowBackendDeterministicRerankerFallback: boolean;
  allowQdrantFailSoft: boolean;
  allowDeterministicAnswerComposer: boolean;
  failChatWhenQualityProviderFallbackUsed: boolean;
}

export function getRuntimeFallbackPolicy(env: Record<string, string | undefined> = process.env): RuntimeFallbackPolicy {
  const profile = resolveRuntimeProfile(env);
  const fallbackAllowed = profile.strictness === "dev_fallback_allowed";
  return {
    profileName: profile.name,
    allowDeterministicEmbeddingFallback: fallbackAllowed,
    allowLightweightRerankerFallback: fallbackAllowed,
    allowBackendDeterministicRerankerFallback: fallbackAllowed,
    allowQdrantFailSoft: fallbackAllowed,
    allowDeterministicAnswerComposer: profile.chat.allowDeterministicComposerBypass,
    failChatWhenQualityProviderFallbackUsed: !fallbackAllowed,
  };
}

export function isQualityFallbackBlocked(env: Record<string, string | undefined> = process.env): boolean {
  return getRuntimeFallbackPolicy(env).failChatWhenQualityProviderFallbackUsed;
}
