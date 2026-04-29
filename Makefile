# R3MES — Linux / macOS uyumlu kısayollar (GNU Make veya BSD make).
# Windows: Git Bash ile `bash start-all.sh` veya WSL kullanın.

SHELL := /bin/bash

.PHONY: start-all docker-up db-migrate dev-stack bootstrap smoke validate release-check release-check-full mvp

# Uçtan uca başlatıcı (Docker + migrate + ai-engine arka plan + Turbo dApp/API)
start-all:
	@bash infrastructure/scripts/start-all.sh

# Yalnızca Docker katmanı (PostgreSQL + IPFS/storage; gateway host 9080)
docker-up:
	-docker compose -f infrastructure/docker/docker-compose.postgres.yml up -d
	-docker compose -f infrastructure/docker/docker-compose.storage.yml up -d

# Yalnızca Prisma migrate (backend-api)
db-migrate:
	pnpm db:migrate

# Turbo ile yalnızca dApp + API (ai-engine’i ayrı başlatmanız gerekir)
dev-stack:
	pnpm exec turbo run dev --filter=@r3mes/backend-api --filter=@r3mes/dapp --parallel

# Docker postgres + storage + Prisma migrate (pnpm bootstrap ile aynı)
bootstrap:
	pnpm bootstrap

# Tam zincir: TS build+test alt kümesi + Move build+test (Sui CLI gerekir)
smoke:
	pnpm smoke

# Test yüzeyi raporu + manifest drift (golden-path); --run-smoke ile smoke:ts
validate:
	pnpm validate

# Teslimat kapısı: validate + smoke:ts + MVP özeti (Move hariç)
release-check:
	pnpm release:check

# release:check ile aynı (tek giriş noktası)
mvp:
	pnpm mvp

# validate + tam smoke (Move; Sui CLI gerekir)
release-check-full:
	pnpm release:check:full
