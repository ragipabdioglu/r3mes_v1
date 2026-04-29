# `dApp` (`apps/dApp`)

## Sahiplik

- **Sorumlu ajan:** Frontend (Next.js 14, Tailwind, Sui dApp Kit).
- **Faz 0 referansı:** `docs/infrastructure_architecture.md` — `dapp` kullanıcı arayüzü ve `backend-api` tüketimi.

## Amaç

R3MES kullanıcı paneli: cüzdan, marketplace, chat, stake arayüzü. Üretimde `packages/shared-types` ile API sözleşmesi hizalanır.

## Yerel geliştirme (backend zorunlu)

| Süreç | Port | Not |
|--------|------|-----|
| `pnpm dev` (bu paket) | **3001** | `package.json`: `next dev -p 3001` |
| `@r3mes/backend-api` | **3000** | `PORT` yoksa 3000; `GET /health` → `{"status":"ok"}` |

Tarayıcı `net::ERR_CONNECTION_REFUSED` → **3000’de dinleyen süreç yok** (API kapalı) veya `NEXT_PUBLIC_BACKEND_URL` yanlış. Çözüm:

1. Repo kökünde `pnpm dev` (turbo, `backend-api` + `dApp` paralel) **veya** ayrı terminallerde `pnpm --filter @r3mes/backend-api dev` ve `pnpm --filter @r3mes/dapp dev`.
2. `apps/dApp/.env.local`: `NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:3000` (veya `http://localhost:3000`). Env değişince **Next’i yeniden başlat**.
3. Doğrulama: `curl http://127.0.0.1:3000/health` → 200 + JSON.

Upload 4xx/5xx = API’ye ulaşıldı (imza, GGUF doğrulama vb.); **connection refused** = API’ye hiç ulaşılmadı.
