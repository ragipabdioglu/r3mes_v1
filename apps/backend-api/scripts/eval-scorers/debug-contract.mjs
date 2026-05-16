const DEBUG_CONTRACT_VERSION_PATHS = [
  "debug_contract_version",
  "debugContractVersion",
  "eval_debug_contract.version",
  "evalDebugContract.version",
  "retrieval_debug.debug_contract_version",
  "retrieval_debug.debugContractVersion",
];

function splitPath(path) {
  return String(path)
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
}

function getNestedValue(rootValue, path) {
  let current = rootValue;
  for (const part of splitPath(path)) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function firstPresent(rootValue, paths) {
  for (const path of paths) {
    const value = getNestedValue(rootValue, path);
    if (value !== undefined && value !== null) return { path, value };
  }
  return { path: paths[0], value: undefined };
}

export function readDebugContract(response) {
  const version = firstPresent(response, DEBUG_CONTRACT_VERSION_PATHS);
  const safetyGate = firstPresent(response, [
    "safety_gate",
    "safetyGate",
    "eval_debug_contract.safety_gate",
    "eval_debug_contract.safetyGate",
    "evalDebugContract.safetyGate",
    "retrieval_debug.safety_gate",
    "retrieval_debug.safetyGate",
  ]);
  const answerPlan = firstPresent(response, [
    "answer_plan",
    "answerPlan",
    "eval_debug_contract.answer_plan",
    "eval_debug_contract.answerPlan",
    "evalDebugContract.answerPlan",
    "retrieval_debug.answerPlan",
    "retrieval_debug.answer_plan",
  ]);
  const answerQuality = firstPresent(response, [
    "answer_quality",
    "answerQuality",
    "eval_debug_contract.answer_quality",
    "eval_debug_contract.answerQuality",
    "evalDebugContract.answerQuality",
    "retrieval_debug.answerQuality",
    "retrieval_debug.answer_quality",
  ]);

  return {
    version: version.value ?? null,
    versionPath: version.value === undefined ? null : version.path,
    safetyGate: safetyGate.value ?? null,
    safetyGatePath: safetyGate.value === undefined ? null : safetyGate.path,
    answerPlan: answerPlan.value ?? null,
    answerPlanPath: answerPlan.value === undefined ? null : answerPlan.path,
    answerQuality: answerQuality.value ?? null,
    answerQualityPath: answerQuality.value === undefined ? null : answerQuality.path,
  };
}

export function scoreDebugContract(testCase, response) {
  const contract = readDebugContract(response);
  const failures = [];

  if (testCase.debugRequired === true) {
    if (!contract.safetyGate) failures.push("debug_contract_missing_safety_gate");
    if (!contract.answerPlan) failures.push("debug_contract_missing_answer_plan");
    if (!contract.answerQuality) failures.push("debug_contract_missing_answer_quality");
    if (!contract.version) failures.push("debug_contract_version_missing");
  }

  if (typeof testCase.expectDebugContractVersion === "string" && testCase.expectDebugContractVersion.trim()) {
    const expected = testCase.expectDebugContractVersion.trim();
    if (!contract.version) {
      if (!failures.includes("debug_contract_version_missing")) {
        failures.push("debug_contract_version_missing");
      }
    } else if (contract.version !== expected) {
      failures.push(`debug_contract_version_mismatch:${contract.version}`);
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    contract,
  };
}
