# R3MES MASTER PLAN: SENIOR-LEVEL ÜRÜN YAŞAM DÖNGÜSÜ (SDLC)

R3MES gibi çok katmanlı (AI, Web3, Mikroservis) bir projenin 6 fazda tamamlanması risklidir (Monolithic planning antipattern). Karmaşayı (chaos) minimize etmek ve izolasyon ilkesini (separation of concerns) korumak adına plan **12 izole faza** genişletilmiş ve uzman ajanların rolleri kesin hatlarla belirlenmiştir.

## Proje Ajan Matrisi
- **Blockchain Ajanı:** Move Akıllı Kontratlar (Sui)
- **Yapay Zeka (AI) Ajanı:** BitNet b1.58 Entegrasyonu, LoRA Benchmark Pipeline (Python)
- **Backend Ajanı:** Fastify, Redis, PostgreSQL (Mikroservisler)
- **Frontend Ajanı:** Next.js 14, Tailwind, Sui dApp Kit (UI/UX)
- **Altyapı Ajanı:** Docker, K8s, IPFS, CI/CD, Terraform
- **Güvenlik Ajanı:** Audit, Fuzzing, Penetrasyon Testleri, Tehdit Modelleme

---

## 1. MİMARİ VE ALTYAPI FAZLARI (Temel İnşaası)

### Faz 0: Mimari Tasarım ve Sistem Spesifikasyonları (Architecture & Specs)
*   **Amacı:** Kod yazmadan önce tüm API sözleşmelerinin, DB şemalarının, GraphQL tiplerinin ve K8s mimarisinin kağıt üzerinde kusursuzlaştırılması. Ajanlar arası veri tiplerini (Type validation) kilitlemek.
*   **Kritik Bağımlılık:** Karar mekanizmaları (Orchestrator).
*   **Teslim Kriterleri:** OpenAPI/Swagger dökümanları, DB Schema mimarisi ve Mermaid sekans diyagramları.
*   **Aktif Ajanlar:** Tüm Ajanlar (Öncelikli: Yönetici Ajan) | **Paralel mi?** Evet

### Faz 1: Altyapı ve Monorepo Kurulumu (Infrastructure & Scaffolding)
*   **Amacı:** Turborepo/Nx ile monorepo kurulumu. K8s (Kubernetes) pod/helm chart'ları, Terraform dosyaları ve GitHub Actions CI/CD akışlarının oluşturulması.
*   **Kritik Bağımlılık:** Faz 0.
*   **Teslim Kriterleri:** Her ajanın kendi klasöründe boş bir template derleyip CI pipeline testinden (Lint/Format/Build) başarıyla geçirmesi.
*   **Aktif Ajanlar:** Altyapı Ajanı | **Paralel mi?** Sıralı (Blocker)

### Faz 2: Merkeziyetsiz Depolama ve AI Temeli (Storage & Frozen Core)
*   **Amacı:** BitNet b1.58'in quantize edilmiş (1-bit) ağırlıklarının parçalanarak (chunking) IPFS'e seed/pin işlemi. CDN ve Redis Cache ile IPFS Gateway hız optimizasyonları.
*   **Kritik Bağımlılık:** Faz 1.
*   **Teslim Kriterleri:** Dev model dosyasının IPFS üzerinden yüksek hızda, kopmadan çekilip bir dummy sistem üzerinde memory'ye yükleme testini geçmesi.
*   **Aktif Ajanlar:** Altyapı Ajanı, AI Ajanı | **Paralel mi?** Kısmen Paralel

---

## 2. ÇEKİRDEK İŞ MANTIĞI FAZLARI (Core Business Logic)

### Faz 3: Sui Akıllı Kontratların Geliştirilmesi (Move Smart Contracts)
*   **Amacı:** R3MES token (Fungible Token), LoRA staking havuzu (Pool), model adaptör register (kayıt) kontratları ve mikro-ücret escrow sözleşmelerinin Move diliyle yazılması.
*   **Kritik Bağımlılık:** Faz 0 (Sözleşme kontrat şemaları).
*   **Teslim Kriterleri:** Sui Move Analyzer testlerinden %100 coverage ile geçilmesi. Sui Localnet'e deploy edilmesi.
*   **Aktif Ajanlar:** Blockchain Ajanı | **Paralel mi?** Faz 4 ve Faz 5 ile eş zamanlı yürüyebilir.

### Faz 4: Çekirdek Backend Servisleri (Core Data Layer & Indexer)
*   **Amacı:** Fastify framework, Prisma ORM (veya Drizzle) ile PostgreSQL entegrasyonu. En kritik parça: Sui node'larının WebSocket üzerinden dinlenmesi ve Sui on-chain eventlerinin (olaylarının) ilişkisel veritabanına indekslenmesi (Indexer).
*   **Kritik Bağımlılık:** Faz 3 (Event signature'ları belli olmadan indexer yazılamaz).
*   **Teslim Kriterleri:** Akıllı kontrattaki bir transfer veya register transaction event'inin en geç 2 saniye içinde ilişkisel DB'ye işlenmesi.
*   **Aktif Ajanlar:** Backend Ajanı | **Paralel mi?** Faz 5 ile paralel yürüyecek.

### Faz 5: AI LoRA Çıkarım Motoru (Inference Engine)
*   **Amacı:** Kullanılan LoRA ağırlıklarını BitNet core modelinin üstüne "anında" (on-the-fly) monte eden Python FastAPI tabanlı inference Worker API'sinin yazılması.
*   **Kritik Bağımlılık:** Faz 2.
*   **Teslim Kriterleri:** REST API üzerinden gelen bir "prompt" isteğine (örneğin "Hello, AI"), özel X id'li LoRA adaptörü kurallarıyla başarılı LLM text yanıtı dönmesi.
*   **Aktif Ajanlar:** AI Ajanı | **Paralel mi?** Devam edebilir.

---

## 3. OTONOM SİSTEMLER VE ARAYÜZ (QA & UI)

### Faz 6: Otonom Kalite Güvence ve Benchmark Sistemi (QA Sandbox)
*   **Amacı:** Kullanıcı, sistem için bir LoRA eğittiğinde; otomatik olarak izole bir Docker container ayağa kalkıp bu modeli bir değerlendirmeye alacak (LLM-as-a-judge, BLEU score). İyi çıkmazsa red mekanizması işletilecek.
*   **Kritik Bağımlılık:** Faz 5.
*   **Teslim Kriterleri:** Overfit çalışmış çöp bir LoRA dataseti yüklendiğinde, pipeline'ın bunu sistemin kalitesini düşüreceği gerekçesiyle tespit edip reddetmesi, Blockchain indexer'a red işlemini iletmesi.
*   **Aktif Ajanlar:** AI Ajanı, Güvenlik Ajanı | **Paralel mi?** Sıralı

### Faz 7: Frontend ve Web3 UI/UX (DApp)
*   **Amacı:** Sistemi somutlaştıracak Next.js 14 tabanlı kullanıcı panelinin yapılması. Sui cüzdan entegrasyonu (Mysten Labs dApp kit), eğiticinin LoRA zip dosyasını yükleyeceği "Stüdyo" ekranlarının yapılması.
*   **Kritik Bağımlılık:** Faz 4 (API) ve Faz 3 (Sui).
*   **Teslim Kriterleri:** Sui cüzdanı ile kesintisiz giriş yapılması, R3MES bakiyesinin web'de anlık görülmesi.
*   **Aktif Ajanlar:** Frontend Ajanı | **Paralel mi?** Paralel.

---

## 4. ENTEGRASYON VE LANSMAN (Integration & Mainnet)

### Faz 8: Uçtan Uca Entegrasyon Testleri (End-to-End E2E)
*   **Amacı:** Bileşenlerin birbirine bağlanması: Token stake et -> Zip dosyanı yükle -> Benchmark kabul etsin (veya reddetsin) -> Sui'ye yazılsın -> Kullanıcı UI'dan bu adaptörü seçip chat başlatsın -> Her mesajda hesaplardan nano fee düşsün.
*   **Kritik Bağımlılık:** Tüm önceki fazların tamamlanıp Unit Testlerini geçmiş olması.
*   **Teslim Kriterleri:** Sistem üzerindeki "Happy Path" akışının simüle edilen 10 bot kullanıcı tarafından takılma (bottleneck) veya gecikme olmadan eşzamanlı tamamlanması.
*   **Aktif Ajanlar:** Tüm Ajanlar | **Paralel mi?** Blocker (Tümü)

### Faz 9: Güvenlik, Penetrasyon ve Yük Testleri (Security & Scalability)
*   **Amacı:** Sistemin saldırmalara karşı sınanması (Red Teaming). API Rate Limiting aşınmaları, K8s autoscaler testleri, akıllı kontratlarda Re-entrancy ve overflow zorlamaları, Inference Node prompt injection (Zehirleme) denemeleri.
*   **Kritik Bağımlılık:** Faz 8.
*   **Teslim Kriterleri:** Zafiyet Raporlarında kritik açıkların "Resolution" statüsüne çekilmesi. Yük testlerinde sunucuların çökmemesi.
*   **Aktif Ajanlar:** Güvenlik Ajanı, Altyapı Ajanı | **Paralel mi?** Sıralı

### Faz 10: Teşvikli Testnet Lansmanı (Incentivized Testnet)
*   **Amacı:** Sui Testnet ağına tam projenin devri. X (eski Twitter) veya Discord üzerinden duyuru ile gerçek "Trainer"ları projeye çekip stress testi yaratmak. Oyunlaştırılmış token ödül havuzu ile liderlik tablolarının gerçek hayattaki davranışları test etmesi.
*   **Kritik Bağımlılık:** Faz 9 Security Audit onayı!
*   **Teslim Kriterleri:** Sistemin ilk kullanıcılarıyla çökmeden asgari 2 hafta kesintisiz operasyon sürdürmesi ve "Stake Slash" kurallarının gerçek dünyada haklı şekilde işlemesi.
*   **Aktif Ajanlar:** Tüm Ajanlar | **Paralel mi?** Sıralı

### Faz 11: Mainnet Lansmanı ve DAO Yetki Devri (Genesis)
*   **Amacı:** Ürün canlıya (Production) çıkar. Akıllı sözleşmeler "Immutable" (değiştirilemez) kılınır veya upgrade yetkileri topluluk Multisig cüzdanına devredilir (Decentralization). R3MES Coin Tokenomics planının start alması (TGE - Token Generation Event).
*   **Kritik Bağımlılık:** Faz 10.
*   **Teslim Kriterleri:** Başarılı genesis deployment. 
*   **Aktif Ajanlar:** Yönetici Ajan (Orchestrator) & Takım | **Paralel mi?** Final

---

## Güncel Monorepo Dosya/Klasör Mimarisi

```text
r3mes-monorepo/
├── apps/
│   ├── dApp/             # (Frontend Ajanı) Next.js, Sui dApp Kit
│   ├── backend-api/      # (Backend Ajanı) Fastify REST ve GraphQL Gateway
│   └── ai-engine/        # (Yapay Zeka Ajanı) FastAPI, BitNet & LoRA Model Yükleyici Modülü
├── packages/
│   ├── sui-contracts/    # (Blockchain Ajanı) Move VM akıllı kontratları (Coin & Staking)
│   ├── sui-indexer/      # (Backend Ajanı) Sui Event listener & Database State Sync modülü
│   ├── qa-sandbox/       # (Yapay Zeka & Güv. Ajanı) İzole Docker Test Benchmarking ortamı
│   └── shared-types/     # (Frontend & Backend Ajanı) Güvenli Zod tipleri, Interface paketleri
├── infrastructure/       # (Altyapı Ajanı) K8s, Terraform, Dockerfile'lar, Load Balancer
└── security/             # (Güvenlik Ajanı) Fuzzing Test Case'leri, Tehdit Raporu Setleri
```
