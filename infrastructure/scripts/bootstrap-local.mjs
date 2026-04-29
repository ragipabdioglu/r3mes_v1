import { execSync } from "node:child_process";

const root = process.cwd();

function run(command, args, label) {
  try {
    execSync([command, ...args].join(" "), {
      cwd: root,
      stdio: "inherit",
    });
  } catch (error) {
    const status = error?.status ?? "unknown";
    throw new Error(`${label} failed with exit code ${status}`);
  }
}

function inspectHealth(containerName) {
  try {
    return execSync(
      `docker inspect -f "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}" ${containerName}`,
      {
        cwd: root,
        encoding: "utf8",
      },
    ).trim();
  } catch {
    return null;
  }
}

async function waitForHealth(containerName, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = inspectHealth(containerName);
    if (status === "healthy") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`Timed out waiting for ${containerName} to become healthy`);
}

async function main() {
  run("docker", ["compose", "-f", "infrastructure/docker/docker-compose.postgres.yml", "up", "-d"], "postgres compose up");
  run("docker", ["compose", "-f", "infrastructure/docker/docker-compose.storage.yml", "up", "-d"], "storage compose up");

  await waitForHealth("r3mes-postgres", 120_000);
  await waitForHealth("r3mes-redis-cache", 120_000);
  await waitForHealth("r3mes-qdrant", 120_000);
  await waitForHealth("r3mes-ipfs", 120_000);
  await waitForHealth("r3mes-storage-gateway", 120_000);

  run("pnpm", ["db:migrate"], "database migrate");
}

main().catch((error) => {
  console.error(`[bootstrap-local] ${error.message}`);
  process.exit(1);
});
