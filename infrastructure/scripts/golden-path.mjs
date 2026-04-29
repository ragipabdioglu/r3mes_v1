#!/usr/bin/env node
/**
 * Golden path validation — tek giriş noktası:
 * - infrastructure/test-surface.json ile workspace package.json test script drift kontrolü
 * - Özet + tablo + aksiyon adımları; CI’da GITHUB_STEP_SUMMARY
 * - --run-smoke: smoke:ts (Move hariç tam zincir)
 * - --json: makine okunur çıktı (stdout, son satır)
 *
 * Kullanım: pnpm validate   |   pnpm validate -- --run-smoke   |   pnpm validate -- --json
 */
import { readFileSync, existsSync, readdirSync, appendFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

function listWorkspacePackageJsonPaths() {
  const paths = [];
  for (const ent of readdirSync(join(ROOT, "apps"), { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const p = join(ROOT, "apps", ent.name, "package.json");
    if (existsSync(p)) paths.push(p);
  }
  for (const ent of readdirSync(join(ROOT, "packages"), { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const p = join(ROOT, "packages", ent.name, "package.json");
    if (existsSync(p)) paths.push(p);
  }
  const worker = join(ROOT, "packages/qa-sandbox/worker/package.json");
  if (existsSync(worker) && !paths.includes(worker)) paths.push(worker);
  return paths;
}

/** @returns {{ surface: 'real'|'skip'|'none', runner: string | null }} */
function classifyTestScript(testScript) {
  if (!testScript || typeof testScript !== "string") {
    return { surface: "none", runner: null };
  }
  const s = testScript;
  if (s.includes("test-skip.mjs")) {
    return { surface: "skip", runner: "explicit-skip" };
  }
  if (s.includes("vitest")) return { surface: "real", runner: "vitest" };
  if (s.includes("pytest")) return { surface: "real", runner: "pytest" };
  if (/sui\s+move\s+test/.test(s) || s.trim() === "sui move test") {
    return { surface: "real", runner: "sui-move" };
  }
  return { surface: "real", runner: "other" };
}

function loadManifest() {
  const p = join(ROOT, "infrastructure/test-surface.json");
  const raw = JSON.parse(readFileSync(p, "utf8"));
  const packages = raw.packages ?? {};
  const meta = raw._meta && typeof raw._meta === "object" ? raw._meta : null;
  return { packages, meta };
}

function pad(s, n) {
  const str = String(s);
  return str.length >= n ? str.slice(0, n - 2) + ".." : str + " ".repeat(n - str.length);
}

function rel(p) {
  return relative(ROOT, p).replace(/\\/g, "/");
}

/**
 * @param {object} params
 * @param {boolean} params.ok
 * @param {number} params.aligned
 * @param {number} params.realCount
 * @param {number} params.skipCount
 * @param {Array<{kind: string, pkg: string, detail: string, relPath: string, fix: string}>} params.issues
 * @param {Array<{pkg: string, manifest: string, detected: string, fix: string}>} params.runnerWarnings
 * @param {Array<{name: string, path: string, drift: boolean, actual: { surface: string, runner: string | null }}>} params.rows
 */
function writeGithubStepSummary(params) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;

  const lines = [];
  lines.push("## Golden path — test yüzeyi");
  lines.push("");
  if (params.ok) {
    lines.push(`**Durum: uyumlu** — ${params.aligned} paket manifest ile eşleşiyor (gerçek test: ${params.realCount}, bilinçli skip: ${params.skipCount}).`);
  } else {
    lines.push(`**Durum: drift** — ${params.issues.length} sorun düzeltilmeli.`);
  }
  lines.push("");
  lines.push("| Paket | Durum | Yüzey | Runner |");
  lines.push("|--------|--------|--------|--------|");
  for (const r of params.rows) {
    const surf =
      r.actual.surface === "real" ? "gerçek" : r.actual.surface === "skip" ? "skip" : "—";
    const st = r.drift ? "DRIFT" : "ok";
    const run = r.actual.runner ?? "—";
    lines.push(`| \`${r.name}\` | ${st} | ${surf} | ${run} |`);
  }
  lines.push("");
  if (params.issues.length > 0) {
    lines.push("### Sorunlar");
    for (const i of params.issues) {
      lines.push(`- **${i.pkg}** (${i.kind}): ${i.detail}`);
      lines.push(`  - Dosya: \`${i.relPath}\``);
      lines.push(`  - **Ne yapın:** ${i.fix}`);
    }
    lines.push("");
  }
  if (params.runnerWarnings.length > 0) {
    lines.push("### Runner uyarıları (yüzey doğru, runner etiketi farklı)");
    for (const w of params.runnerWarnings) {
      lines.push(`- \`${w.pkg}\`: manifest \`${w.manifest}\` vs algılanan \`${w.detected}\` — ${w.fix}`);
    }
  }
  lines.push("");
  lines.push("<details><summary>CI ile yerel parite</summary>");
  lines.push("");
  lines.push("Pytest/Move için CI: `pip install -r apps/ai-engine/requirements.txt`, `pip install -e \"packages/qa-sandbox/worker[dev]\"`, `bash infrastructure/scripts/install-sui-ci.sh`.");
  lines.push("</details>");
  lines.push("");
  lines.push("### Release sinyali (bu job)");
  lines.push("");
  if (params.ok) {
    lines.push("- **Manifest:** GO (drift yok). PR ile tutarlılık: yerelde `pnpm validate` = CI `Golden path` adımı.");
  } else {
    lines.push("- **Manifest:** NO-GO — drift giderilmeden release checklist tamamlanmış sayılmaz.");
  }
  lines.push("- Merge/tag öncesi operasyonel GO: yerelde `pnpm release:check` yeşil; Move değiştiyse `pnpm release:check:full`.");
  lines.push("- Rehber: `infrastructure/RELEASE_CHECKLIST.md`");
  lines.push("");

  appendFileSync(path, lines.join("\n"));
}

function main() {
  const args = process.argv.slice(2);
  const runSmoke = args.includes("--run-smoke");
  const jsonOut = args.includes("--json");

  const { packages: manifest, meta } = loadManifest();
  const pkgPaths = listWorkspacePackageJsonPaths();
  const discovered = [];
  /** @type {Array<{kind: string, pkg: string, detail: string, relPath: string, fix: string}>} */
  const issues = [];
  /** @type {Array<{pkg: string, manifest: string, detected: string, fix: string}>} */
  const runnerWarnings = [];

  /** @type {Array<{name: string, path: string, actual: ReturnType<typeof classifyTestScript>, expected: object | null, drift: boolean, testScript: string | undefined}>} */
  const rows = [];

  for (const p of pkgPaths) {
    const j = JSON.parse(readFileSync(p, "utf8"));
    const name = j.name;
    if (!name) continue;
    discovered.push(name);
    const testScript = j.scripts?.test;
    const actual = classifyTestScript(testScript);
    const expected = manifest[name];
    const relPath = rel(p);

    if (!expected) {
      issues.push({
        kind: "MANIFEST_EKSIK",
        pkg: name,
        detail: "`infrastructure/test-surface.json` içinde bu paket için kayıt yok.",
        relPath,
        fix: "`packages` altına yeni bir girdi ekleyin (`surface`, `runner`, `note`) veya paketi workspace’ten kaldırdıysanız manifest’ten silin.",
      });
      rows.push({ name, path: p, actual, expected: null, drift: true, testScript });
      continue;
    }

    const expSurface = expected.surface;
    let drift = false;
    if (actual.surface !== expSurface) {
      drift = true;
      issues.push({
        kind: "YÜZEY_DRIFT",
        pkg: name,
        detail: `Manifest \`surface=${expSurface}\`, package.json test çıktısı \`${actual.surface}\` (script: ${JSON.stringify(testScript)})`,
        relPath,
        fix:
          expSurface === "real"
            ? "`scripts.test` gerçek bir test koşacak şekilde güncelleyin (ör. vitest/pytest/sui) **veya** kasıtlı skip ise manifest’te `surface: \"skip\"` yapın."
            : "`scripts.test` bilinçli atlama için `node …/test-skip.mjs @scope/pkg` kullanın **veya** gerçek test eklediyseniz manifest’te `surface: \"real\"` yapın.",
      });
    }

    const expRunner = expected.runner;
    if (
      !drift &&
      expRunner &&
      actual.runner &&
      actual.runner !== "other" &&
      expRunner !== actual.runner
    ) {
      runnerWarnings.push({
        pkg: name,
        manifest: expRunner,
        detected: actual.runner,
        fix: "`test-surface.json` içindeki `runner` alanını algılanan runner ile eşitleyin veya test script’ini gözden geçirin.",
      });
    }

    rows.push({ name, path: p, actual, expected, drift, testScript });
  }

  for (const name of Object.keys(manifest)) {
    if (!discovered.includes(name)) {
      issues.push({
        kind: "MANIFEST_FAZLA",
        pkg: name,
        detail: "Workspace’te bu isimde paket yok (silinmiş veya yeniden adlandırılmış olabilir).",
        relPath: "infrastructure/test-surface.json",
        fix: "`packages` içinden bu anahtarı kaldırın veya paket adını düzeltin.",
      });
    }
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));

  const aligned = rows.filter((r) => !r.drift).length;
  const realCount = rows.filter((r) => !r.drift && r.actual.surface === "real").length;
  const skipCount = rows.filter((r) => !r.drift && r.actual.surface === "skip").length;
  const ok = issues.length === 0;

  const resultPayload = {
    ok,
    aligned,
    total: rows.length,
    realCount,
    skipCount,
    issueCount: issues.length,
    runnerWarningCount: runnerWarnings.length,
    issues: issues.map((i) => ({ ...i })),
    runnerWarnings,
    packages: rows.map((r) => ({
      name: r.name,
      path: rel(r.path),
      surface: r.actual.surface,
      runner: r.actual.runner,
      drift: r.drift,
      manifestSurface: r.expected?.surface ?? null,
    })),
  };

  if (jsonOut) {
    console.log(JSON.stringify(resultPayload, null, 2));
    process.exit(ok ? 0 : 1);
  }

  // —— İnsan odaklı rapor ——
  console.log("");
  console.log("┌─────────────────────────────────────────────────────────────────────────");
  console.log("│ R3MES golden path — test yüzeyi");
  console.log("└─────────────────────────────────────────────────────────────────────────");
  console.log("");

  if (ok) {
    console.log(`  Durum: UYUMLU  (${aligned}/${rows.length} paket manifest ile eşleşiyor)`);
    console.log(`  Gerçek test: ${realCount} paket  |  Bilinçli skip: ${skipCount} paket`);
  } else {
    console.log(`  Durum: DRIFT — ${issues.length} sorun (CI ve yerel \`pnpm validate\` başarısız olur)`);
    console.log(`  Eşleşen: ${aligned}/${rows.length} paket`);
  }

  if (meta?.whenToEdit) {
    console.log("");
    console.log(`  Not: ${meta.whenToEdit}`);
  }

  console.log("");
  console.log(`${pad("paket", 30)}${pad("durum", 10)}${pad("yüzey", 10)}${pad("runner", 14)}${pad("not (manifest)", 36)}`);
  console.log("-".repeat(100));
  for (const r of rows) {
    const surf =
      r.actual.surface === "real" ? "gerçek" : r.actual.surface === "skip" ? "skip" : "(yok)";
    const run = r.actual.runner ?? "—";
    const note = (r.expected && r.expected.note) || "";
    const status = r.drift ? "DRIFT" : "ok";
    console.log(`${pad(r.name, 30)}${pad(status, 10)}${pad(surf, 10)}${pad(run, 14)}${pad(note, 36)}`);
  }
  console.log("");

  if (runnerWarnings.length > 0) {
    console.log("  Uyarı (yüzey doğru, runner etiketi manifest’ten farklı):");
    for (const w of runnerWarnings) {
      console.log(`    - ${w.pkg}: manifest runner=${w.manifest}, algılanan=${w.detected}`);
      console.log(`      → ${w.fix}`);
    }
    console.log("");
  }

  if (!ok) {
    console.log("  --- Ne yapmalı? ---");
    let n = 1;
    for (const i of issues) {
      console.log(`  ${n}. [${i.kind}] ${i.pkg}`);
      console.log(`     ${i.detail}`);
      console.log(`     Dosya: ${i.relPath}`);
      console.log(`     → ${i.fix}`);
      n++;
    }
    console.log("");
    console.error(`[golden-path] ${issues.length} sorun — çıkış kodu 1`);
  } else {
    console.log("  Yerel ↔ CI paritesi (pytest / Move): CI ile aynı komutlar:");
    console.log("    pip install -r apps/ai-engine/requirements.txt");
    console.log("    pip install -e \"packages/qa-sandbox/worker[dev]\"");
    console.log("    Sui (Linux CI): bash infrastructure/scripts/install-sui-ci.sh");
    console.log("");
    console.log("  Sinyal (manifest): GO — PR ile aynı kontrol: ci.yml → «Golden path» adımı.");
    console.log("  Tam çıkış özeti: pnpm mvp  veya  pnpm release:check  (bkz. infrastructure/RELEASE_CHECKLIST.md)");
    console.log("");
  }

  writeGithubStepSummary({
    ok,
    aligned,
    realCount,
    skipCount,
    issues,
    runnerWarnings,
    rows: rows.map((r) => ({
      name: r.name,
      path: rel(r.path),
      drift: r.drift,
      actual: r.actual,
    })),
  });

  if (!ok) {
    process.exit(1);
  }

  if (runSmoke) {
    console.log("[golden-path] smoke:ts çalıştırılıyor (Move hariç; build + test alt kümesi)…\n");
    const r = spawnSync("pnpm", ["run", "smoke:ts"], {
      cwd: ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    process.exit(r.status === null ? 1 : r.status);
  }

  process.exit(0);
}

main();
