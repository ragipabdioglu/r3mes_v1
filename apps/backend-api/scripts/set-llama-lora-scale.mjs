const baseUrl = process.env.R3MES_LLAMA_BASE_URL || "http://127.0.0.1:8080";
const slotId = Number(process.argv[2] ?? process.env.R3MES_LORA_ADAPTER_SLOT_ID ?? "0");
const scale = Number(process.argv[3] ?? process.env.R3MES_LORA_SCALE ?? "1");

if (!Number.isFinite(slotId) || !Number.isFinite(scale)) {
  console.error("usage: node scripts/set-llama-lora-scale.mjs <slotId> <scale>");
  process.exit(1);
}

const getUrl = `${baseUrl.replace(/\/$/, "")}/lora-adapters`;

const current = await fetch(getUrl).then(async (response) => {
  if (!response.ok) {
    throw new Error(`GET /lora-adapters failed: ${response.status} ${await response.text()}`);
  }
  return await response.json();
});

if (!Array.isArray(current) || current.length === 0) {
  throw new Error("llama-server has no loaded LoRA adapters");
}

const next = current.map((adapter) => ({
  id: Number(adapter.id),
  scale: Number(adapter.id) === slotId ? scale : Number(adapter.scale ?? 0),
}));

const response = await fetch(getUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(next),
});

if (!response.ok) {
  throw new Error(`POST /lora-adapters failed: ${response.status} ${await response.text()}`);
}

const updated = await fetch(getUrl).then((res) => res.json());
console.log(JSON.stringify({ slotId, scale, adapters: updated }, null, 2));
