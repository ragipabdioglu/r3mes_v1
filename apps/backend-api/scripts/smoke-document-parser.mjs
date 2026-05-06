import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const backendRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function parseArgs() {
  const file = argValue("--file");
  if (!file) {
    throw new Error("Usage: pnpm --filter @r3mes/backend-api run smoke:document-parser -- --file <path>");
  }
  return {
    file: resolve(root, file),
    failOnNoisy: process.argv.includes("--fail-on-noisy"),
  };
}

async function main() {
  const opts = parseArgs();
  const [{ parseKnowledgeBuffer, chunkKnowledgeText, listKnowledgeParserAdapters }, { scoreKnowledgeParseQuality }] = await Promise.all([
    import(pathToFileURL(resolve(backendRoot, "dist/lib/knowledgeText.js")).href),
    import(pathToFileURL(resolve(backendRoot, "dist/lib/knowledgeParseQuality.js")).href),
  ]);
  const buffer = await readFile(opts.file);
  const parsed = parseKnowledgeBuffer(basename(opts.file), buffer);
  const chunks = chunkKnowledgeText(parsed.text);
  const quality = scoreKnowledgeParseQuality({
    filename: basename(opts.file),
    sourceType: parsed.sourceType,
    text: parsed.text,
    chunks,
  });
  const report = {
    file: opts.file,
    parser: parsed.parser,
    sourceType: parsed.sourceType,
    diagnostics: parsed.diagnostics,
    parseQuality: quality,
    chunkCount: chunks.length,
    chunkPreview: chunks.slice(0, 3).map((chunk) => ({
      chunkIndex: chunk.chunkIndex,
      tokenCount: chunk.tokenCount,
      excerpt: chunk.content.slice(0, 360),
    })),
    availableParsers: listKnowledgeParserAdapters(),
  };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = opts.failOnNoisy && quality.level === "noisy" ? 2 : 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
