# R3MES Agent Project Memory

## Purpose

This directory implements the fixed-agent operating protocol approved on
2026-05-27. Notion phase context pages remain the durable architectural source
of truth; these files are the short working charter read before each task.

## Current Phase State

- Completed: Faz 0, Faz 1, Faz 2, Faz 3.
- Next implementation phase: Faz 4 - Retrieval Quality.
- Faz 4 acceptance should use the Phase 3 Verified B.Y and G.P collections.
- BGE-M3 and QdrantPayloadV2 are verified Phase 3 backbone work.
- LoRA is not part of knowledge correctness; chat must retain a LoRA-free path.

## Fixed Roster

| Responsibility | Actor | Agent ID | Product Code Write Permission |
| --- | --- | --- | --- |
| Architecture controller | Atlas / main Codex thread | Main thread | No, except announced tiny integration repair |
| Explorer / risk auditor | Locke | `019e6117-ec95-7d02-87c8-f18c01d84a88` | No |
| Contract and implementation worker | Pascal | `019e6118-2830-7e40-9003-18a936023b23` | Yes, assigned files only |
| Verifier / eval guard | Newton | `019e6118-5be4-79d1-84e7-bc5c794dea89` | No |
| Reserve | Huygens | `019e611e-e0de-7540-b718-2838b670f4a4` | Only after user approval |

## Non-Negotiable Rules

- Do not create a new subagent unless the user explicitly authorizes it.
- All other prior agents are historical/inactive.
- One implementation slice has one writer; do not write the same file in parallel.
- Out-of-phase findings are recorded in the proper backlog, not patched in.
- Public/debug boundary, strict fallback policy, and failure taxonomy are verified per slice.
- Core logic must not contain dataset-specific literals; fixtures and generated content may.
- Do not perform destructive cleanup without audit and user approval.

## Required Read Order

1. Relevant Notion Phase Context and Global Contract Map entries.
2. This project memory file.
3. The assigned role charter in this directory.
4. Only the source files owned by the assigned task.

## Standard Stage Flow

1. Atlas defines a bounded task and file ownership.
2. Locke audits first only when the scope is new or risky.
3. Pascal implements within ownership.
4. Newton independently verifies the diff and required gates.
5. Atlas accepts or rejects, commits/pushes accepted work, and updates Notion.

## Search and Reporting Limits

- No unscoped repository-wide scans.
- Default search budget is five targeted `rg` searches per task; explain expansion.
- Agent handoffs are at most 80 lines; per-task memory additions are at most 15 lines.
- Report test results as command, exit code, outcome, and failure reason; omit raw logs.
