/**
 * Ortak API ve kuyruk tipleri — Fastify (BullMQ + Redis liste), QA Worker (Python),
 * webhook ve istemci yanıtları arasında tip uyumu için tek kaynak.
 *
 * Kanonik kimlik ve alan sözlüğü: `canonical.ts` + `docs/api/INTEGRATION_CONTRACT.md`.
 */

export * from "./canonical.js";
export * from "./apiContract.js";
export * from "./payloadTypes.js";
export * from "./schemas.js";
export * from "./contractGuards.js";
export * from "./r3mesTestnetMock.js";

/** Geriye dönük: `packages/qa-sandbox` TS köprüsü */
export const R3MES_SHARED_TYPES_PLACEHOLDER = true;
