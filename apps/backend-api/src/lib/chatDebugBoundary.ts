type HeaderValue = string | string[] | undefined;

function firstHeaderValue(value: HeaderValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isTruthyFlag(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

function isDisabledFlag(value: string | undefined): boolean {
  return ["0", "false", "no", "off"].includes((value ?? "").trim().toLowerCase());
}

export function shouldExposeChatDebugFromHeaders(
  headers: Record<string, HeaderValue>,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isTruthyFlag(env.R3MES_EXPOSE_CHAT_DEBUG)) return true;

  const requested = isTruthyFlag(firstHeaderValue(headers["x-r3mes-debug"]));
  if (!requested) return false;

  if (isTruthyFlag(env.R3MES_ALLOW_CHAT_DEBUG_HEADER)) return true;
  if (isDisabledFlag(env.R3MES_ALLOW_CHAT_DEBUG_HEADER)) return false;

  // Default-safe boundary: local/dev can opt in with the header, production must
  // explicitly allow it through R3MES_ALLOW_CHAT_DEBUG_HEADER=1.
  return env.NODE_ENV !== "production";
}
