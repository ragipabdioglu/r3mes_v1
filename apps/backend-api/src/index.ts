import { assertQaWebhookSecretConfigured, buildApp } from "./app.js";

assertQaWebhookSecretConfigured();

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

const app = await buildApp();
await app.listen({ port, host });
