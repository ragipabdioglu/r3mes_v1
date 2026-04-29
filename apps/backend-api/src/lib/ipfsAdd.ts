/**
 * Kubo HTTP API (port 5001) — tek dosya pin; gateway 8080 üzerinden QA worker erişir.
 */
function getIpfsAddTimeoutMs(): number {
  const raw = Number(process.env.R3MES_IPFS_ADD_TIMEOUT_MS ?? 30_000);
  return Number.isFinite(raw) && raw > 0 ? raw : 30_000;
}

function parseHashFromLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as { Hash?: unknown };
    return typeof parsed.Hash === "string" && parsed.Hash.length > 0 ? parsed.Hash : null;
  } catch {
    return null;
  }
}

export async function ipfsAddBuffer(
  apiBase: string,
  buffer: Buffer,
  filename: string,
): Promise<string> {
  const base = apiBase.replace(/\/$/, "");
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(buffer)]), filename);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getIpfsAddTimeoutMs());

  let res: Response;
  try {
    res = await fetch(`${base}/api/v0/add?pin=true`, {
      method: "POST",
      body: fd,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    clearTimeout(timeout);
    throw new Error(`IPFS add failed: ${res.status} ${t}`);
  }

  if (!res.body) {
    clearTimeout(timeout);
    throw new Error("IPFS add: response body yok");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) {
          const hash = parseHashFromLine(line);
          if (hash) {
            await reader.cancel().catch(() => undefined);
            clearTimeout(timeout);
            return hash;
          }
        }
      }
      if (done) break;
    }
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }

  const finalHash = parseHashFromLine(pending);
  clearTimeout(timeout);
  if (finalHash) return finalHash;
  throw new Error("IPFS add: yanıtta Hash yok");
}
