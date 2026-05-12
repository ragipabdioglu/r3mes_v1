import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const checks = [
  {
    name: "embedding-provider",
    script: "smoke-embedding-provider.mjs",
    env: {
      R3MES_REQUIRE_REAL_EMBEDDINGS: "1",
    },
  },
  {
    name: "reranker-provider",
    script: "smoke-reranker-provider.mjs",
    env: {
      R3MES_REQUIRE_REAL_RERANKER: "1",
    },
  },
  {
    name: "bge-m3-backbone",
    script: "smoke-bge-m3-backbone.mjs",
    env: {
      R3MES_QDRANT_REINDEX_REQUIRE_REAL_EMBEDDINGS: "1",
    },
  },
];

function runCheck(check) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--env-file=.env", `scripts/${check.script}`], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        ...process.env,
        ...check.env,
      },
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${check.name} smoke failed with exit code ${code ?? "unknown"}`));
    });
  });
}

for (const check of checks) {
  console.log(`\n[r3mes-quality-provider] ${check.name}`);
  await runCheck(check);
}

console.log("\n[r3mes-quality-provider] ok");
