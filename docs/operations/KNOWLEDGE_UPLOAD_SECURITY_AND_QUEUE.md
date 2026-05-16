# Knowledge Upload Security Scan and Queue Modes

Section 05 ingestion remediation adds two operational contracts without changing local development defaults.

## Upload malware scan

`scanKnowledgeUpload` returns the existing upload decision (`CLEAN`, `QUARANTINED`, `FAILED`) plus provider diagnostics:

- `provider`: `local_stub`, `command`, or `env_override`
- `status`: provider health (`ok`, `warning`, `error`)
- `durationMs`
- `reason`
- optional `scannerVersion` and `signature`

Local development still defaults to the deterministic `local_stub`, which only detects the EICAR test signature and reports a warning diagnostic. Production or strict mode fails closed if the local stub would be used:

- `R3MES_KNOWLEDGE_SCAN_MODE=strict`, `R3MES_KNOWLEDGE_SCAN_STRICT=1`, or `NODE_ENV=production`
- set `R3MES_KNOWLEDGE_SCAN_PROVIDER=command` for an external scanner command
- set `R3MES_KNOWLEDGE_SCAN_ALLOW_LOCAL_STUB=1` only for an explicit, temporary exception

Command scanner mode uses `R3MES_KNOWLEDGE_SCAN_COMMAND` and appends the stored file path when available. Exit code `0` is clean, exit code `1` is quarantined, and other failures fail closed.

## Ingestion queue

Existing queue modes remain unchanged:

- `background` (default): local `queueMicrotask`
- `inline`: process during the request path
- `manual`: do not enqueue

`R3MES_KNOWLEDGE_INGESTION_MODE=bullmq` enables a durable BullMQ producer when Redis is configured with `R3MES_KNOWLEDGE_INGESTION_REDIS_URL` or `REDIS_URL`. The queue name defaults to `r3mes-knowledge-ingestion` and can be overridden with `R3MES_KNOWLEDGE_INGESTION_QUEUE_NAME`.

This change adds the producer contract only. A deployed BullMQ worker still needs to consume `process-knowledge-ingestion` jobs and call the existing ingestion processor.
