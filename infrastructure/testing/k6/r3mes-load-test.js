/**
 * R3MES — K6 yük testi (Code as Infrastructure).
 * CANLI ÇALIŞTIRMA: Yalnızca izole yük ortamında, onaylı pencerelerde — bu repoda betik saklanır, otomatik koşturulmaz.
 *
 * Uçlar:
 *  - Fastify: GET  /v1/adapters
 *  - FastAPI: POST /v1/chat/completions (bellek ağırlıklı)
 *
 * Ortam:
 *  - R3MES_API_BASE   örn. https://api.staging.r3mes.local  (Fastify ön yüzü)
 *  - R3MES_AI_BASE    örn. https://ai.staging.r3mes.local   (FastAPI — ayrı servis varsayımı)
 *  - R3MES_AUTH_TOKEN isteğe bağlı Bearer
 *
 * Tek komut örneği (referans — prod'a karşı çalıştırmayın):
 *  k6 run infrastructure/testing/k6/r3mes-load-test.js
 */

import http from "k6/http";
import { check, sleep } from "k6";

function randomIntBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const apiBase = (__ENV.R3MES_API_BASE || "http://127.0.0.1:3000").replace(/\/$/, "");
const aiBase = (__ENV.R3MES_AI_BASE || "http://127.0.0.1:8000").replace(/\/$/, "");
const authHeader = __ENV.R3MES_AUTH_TOKEN
  ? { Authorization: `Bearer ${__ENV.R3MES_AUTH_TOKEN}` }
  : {};

const chatPayload = JSON.stringify({
  model: __ENV.R3MES_CHAT_MODEL || "r3mes-bitnet-b158",
  messages: [{ role: "user", content: "loadtest ping — kısa yanıt üret." }],
  max_tokens: Number(__ENV.R3MES_CHAT_MAX_TOKENS || 32),
  temperature: 0.2,
});

/** 0 → 5000 sanal kullanıcı, 2 dakikada tırmanış (tek ramp stage). */
export const options = {
  scenarios: {
    r3mes_ramp: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [{ duration: "2m", target: 5000 }],
      gracefulRampDown: "30s",
      tags: { scenario: "r3mes_ramp" },
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<8000"],
    checks: ["rate>0.90"],
  },
  tags: {
    project: "r3mes",
    phase: "load_test",
  },
};

const params = {
  headers: {
    "Content-Type": "application/json",
    ...authHeader,
  },
  tags: { component: "mixed" },
  timeout: "120s",
};

export default function () {
  // Bellek yükü inference daha ağır: ~%65 POST chat, ~%35 GET adapters.
  const roll = randomIntBetween(1, 100);
  if (roll <= 35) {
    hitAdapters();
  } else {
    hitChatCompletions();
  }
  sleep(randomIntBetween(1, 3) / 10);
}

function hitAdapters() {
  const res = http.get(`${apiBase}/v1/adapters?limit=20`, {
    ...params,
    tags: { endpoint: "adapters", service: "fastify" },
  });
  check(res, {
    "adapters status 2xx": (r) => r.status >= 200 && r.status < 300,
  });
}

function hitChatCompletions() {
  const res = http.post(`${aiBase}/v1/chat/completions`, chatPayload, {
    ...params,
    tags: { endpoint: "chat_completions", service: "fastapi" },
  });
  check(res, {
    "chat status ok": (r) =>
      (r.status >= 200 && r.status < 300) || r.status === 202,
  });
}
