import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function hasArg(name) {
  return process.argv.includes(name);
}

const appRoot = process.cwd();
const repoRoot = resolve(appRoot, "..", "..");
const outFile = resolve(repoRoot, argValue("--out", "artifacts/evals/feedback-gate/latest.json"));
const feedbackGolden = "artifacts/evals/feedback-regression/golden.jsonl";
const feedbackOut = "artifacts/evals/feedback-regression/latest.json";
const baseUrl = argValue("--base-url", process.env.R3MES_BACKEND_URL || "http://127.0.0.1:3000");
const requireApproved = hasArg("--require-approved");
const quick = hasArg("--quick");
const commandTimeoutMs = Number(argValue("--timeout-ms", process.env.R3MES_FEEDBACK_GATE_TIMEOUT_MS || "240000"));

function commandToString(command, args) {
  return [command, ...args].join(" ");
}

function runCommand(name, command, args) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: appRoot,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = Number.isFinite(commandTimeoutMs) && commandTimeoutMs > 0
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill("SIGTERM");
          resolve({
            name,
            command: commandToString(command, args),
            ok: false,
            timedOut: true,
            exitCode: null,
            durationMs: Date.now() - started,
            error: `command timed out after ${commandTimeoutMs}ms`,
            stdout: stdout.slice(-4000),
            stderr: stderr.slice(-4000),
          });
        }, commandTimeoutMs)
      : null;
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({
        name,
        command: commandToString(command, args),
        ok: false,
        exitCode: null,
        durationMs: Date.now() - started,
        error: error.message,
        stdout: stdout.slice(-4000),
        stderr: stderr.slice(-4000),
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({
        name,
        command: commandToString(command, args),
        ok: code === 0,
        exitCode: code,
        durationMs: Date.now() - started,
        stdout: stdout.slice(-4000),
        stderr: stderr.slice(-4000),
      });
    });
  });
}

async function writeReport(report) {
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function evalArgs(file, out, limit = 0) {
  const args = [
    "scripts/run-grounded-response-eval.mjs",
    "--base-url",
    baseUrl,
    "--file",
    file,
    "--out",
    out,
  ];
  if (limit > 0) {
    args.push("--limit", String(limit));
  }
  return args;
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await readFile(resolve(repoRoot, file), "utf8"));
  } catch {
    return null;
  }
}

async function countJsonlRows(file) {
  const path = resolve(repoRoot, file);
  try {
    const info = await stat(path);
    if (info.size === 0) return 0;
    const raw = await readFile(path, "utf8");
    return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function approvedProposalCount() {
  const wallet = process.env.R3MES_DEV_WALLET || "0x0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d";
  const user = await prisma.user.findUnique({ where: { walletAddress: wallet }, select: { id: true } });
  if (!user) return 0;
  return prisma.knowledgeFeedbackProposal.count({
    where: {
      userId: user.id,
      status: "APPROVED",
    },
  });
}

async function main() {
  const started = Date.now();
  const approvedCount = await approvedProposalCount();
  const checks = [];

  if (requireApproved && approvedCount === 0) {
    const report = {
      ok: false,
      applyAllowed: false,
      reason: "no approved feedback proposals",
      approvedProposalCount: approvedCount,
      checks,
      durationMs: Date.now() - started,
      generatedAt: new Date().toISOString(),
    };
    await writeReport(report);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  }

  checks.push(await runCommand("generate_feedback_regression", "node", [
    "--env-file=.env",
    "scripts/generate-feedback-regression-eval.mjs",
    "--out",
    feedbackGolden,
  ]));

  const feedbackCaseCount = await countJsonlRows(feedbackGolden);
  if (feedbackCaseCount > 0) {
    checks.push(await runCommand("feedback_regression", "node", evalArgs(feedbackGolden, feedbackOut, quick ? 5 : 0)));
  } else {
    checks.push({
      name: "feedback_regression",
      command: "skipped",
      ok: true,
      skipped: true,
      reason: "no feedback-derived eval cases",
      durationMs: 0,
    });
  }

  checks.push(await runCommand("rag_quality_gates", "node", evalArgs(
    "infrastructure/evals/rag-quality-gates/golden.jsonl",
    "artifacts/evals/rag-quality-gates/latest.json",
    quick ? 4 : 0,
  )));

  checks.push(await runCommand("collection_suggestion", "node", evalArgs(
    "infrastructure/evals/collection-suggestion/golden.jsonl",
    "artifacts/evals/collection-suggestion/latest.json",
    quick ? 3 : 0,
  )));

  const evalSummaries = {
    feedbackRegression: await readJsonIfExists(feedbackOut),
    ragQualityGates: await readJsonIfExists("artifacts/evals/rag-quality-gates/latest.json"),
    collectionSuggestion: await readJsonIfExists("artifacts/evals/collection-suggestion/latest.json"),
  };
  const ok = checks.every((check) => check.ok === true);
  const report = {
    ok,
    applyAllowed: ok && approvedCount > 0,
    approvedProposalCount: approvedCount,
    feedbackCaseCount,
    checks,
    summaries: {
      feedbackRegression: evalSummaries.feedbackRegression?.summary ?? null,
      ragQualityGates: evalSummaries.ragQualityGates?.summary ?? null,
      collectionSuggestion: evalSummaries.collectionSuggestion?.summary ?? null,
    },
    durationMs: Date.now() - started,
    quick,
    commandTimeoutMs,
    generatedAt: new Date().toISOString(),
  };

  await writeReport(report);
  console.log(`wrote ${outFile}`);
  console.log(JSON.stringify({
    ok: report.ok,
    applyAllowed: report.applyAllowed,
    approvedProposalCount: report.approvedProposalCount,
    feedbackCaseCount: report.feedbackCaseCount,
    checks: report.checks.map((check) => ({
      name: check.name,
      ok: check.ok,
      skipped: check.skipped === true,
      durationMs: check.durationMs,
    })),
  }, null, 2));
  process.exitCode = ok ? 0 : 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
