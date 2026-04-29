TAMAMLANDI
Stake (/stake)

app/stake/page.tsx: Sunucu sayfası; üstte PageIntro, ortada tamamen istemci StakeDashboard, altta statik sunucu LockupExplainer (çeyreklik vesting tablosu + kısa görsel açıklama).
StakeDashboard: Cüzdan + ensureAuthHeaders ile POST /v1/stake (miktar) ve POST /v1/user/:wallet/rewards/claim; GET /v1/chain/stake/:wallet ve GET /v1/user/:wallet/rewards ile yenileme.
StakeForm: Miktar alanı + “Stake gönder”.
StakeBalanceCard: Stake özeti kartı.
RewardsPanel: Ödül özeti + “Claim (Talep Et)” butonu.
LockupExplainer: Mainnet T0 → 3/6/9. ay %25 serbest metin tablosu (statik).
lib/api/stake-api.ts: Yukarıdaki HTTP uçları ve esnek JSON ayrıştırma.
Studio

AdapterStatusBoard: fetchTrainerAdapters (lib/api/adapters-trainer.ts) ile liste; getAdapterStatusKind (lib/types/adapter-status.ts) → sarı Beklemede, yeşil Aktif, kırmızı Reddedildi.
lib/types/adapter.ts: ownerWallet normalizasyonu (owner / trainer / submittedBy …).
studio-upload-panel: .gguf kabulü ve ağırlık dosyası olarak işleme.
Navigasyon

navbar: Stake linki eklendi.
Test: pnpm --filter @r3mes/dapp build başarılı.

BAĞIMLILIK
Backend: GET /v1/chain/stake/:wallet, GET /v1/user/:wallet/rewards, POST /v1/stake, POST /v1/user/:wallet/rewards/claim sözleşmesi ve imza başlıkları doğrulaması.
Adaptör listesi: GET /v1/adapters + wallet / owner / trainer sorguları veya gövdede owner alanları; aksi halde liste boş / tüm kayıtlar (owner yoksa).
Zincir: Gerçek StakingPool Move çağrısı bu fazda yok; backend köprüsü bekleniyor.
ENGEL
YOK (derleme geçti).

SONRAKİ ADIM ÖNERİSİ
Move StakingPool ile postStakeIntent gövdesini hizalayıp; ödül/claim yanıtlarına göre claimable alanını sabitlemek; AdapterStatusBoard için kimlik doğrulamalı GET veya owner zorunluluğu netleştirildiğinde filtreyi sadeleştirmek.