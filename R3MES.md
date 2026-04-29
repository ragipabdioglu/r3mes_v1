**R3MES**

Merkeziyetsiz Yapay Zeka Egitim Platformu

Senior Seviye Gelistirme Plani | Cok Ajanli Mimari

v1.0 - 2026

| Blockchain<br><br>**Sui Move VM** | Temel Model<br><br>**BitNet b1.58** | Adaptor<br><br>**LoRA / DoRA** |
| --------------------------------- | ----------------------------------- | ------------------------------ |

# **1\. Proje Vizyonu ve Amaci**

R3MES, buyuk teknoloji sirketlerinin kontrolundeki merkezi yapay zeka sistemlerine karsi merkeziyetsiz bir alternatif sunmayi amaclamaktadir. Platform, tek bir dondurulmus temel modeli (BitNet b1.58) uzerinde topluluk tarafindan egitilen LoRA/DoRA adaptorlerini bir araya getirir; her katilimci egittigi adaptore gore R3MES coin kazanir.

**Temel Prensipler**

• Temel model degismez - BitNet b1.58 IPFS'te kilitli, on-chain hash ile dogrulanir

• Kalite merkezi degil - otomatik benchmark filtresi manipulasyonu engeller

• Enflasyon yok - coin mint edilmez, kullanicidan egiticiye transfer edilir

• Cold start cozumu - kapali testnet + lockup mekanizmasiyla baslanir

# **2\. Sistem Mimarisi**

## **2.1 Katmanli Yapi**

Platform dort ana katmandan olusur:

- Blockchain katmani - Sui Move kontratlar, R3MES coin, stake/slash, odul havuzu
- Model katmani - Dondurulmus BitNet IPFS'te, hash Sui'de kayitli
- Egitim katmani - LoRA/DoRA pipeline, otomatik benchmark, adaptorler IPFS'te
- Uygulama katmani - REST/WS API, Next.js frontend, chat ekrani, marketplace

## **2.2 Coin Akisi**

Enflasyonu onlemek icin coin basilmaz. Akis tamamen donguseldir:

- Kullanici chat icin coin stake eder (kendi cuzdan hesabinda kilitli kalir)
- Her inference sorgusunda cok kucuk bir miktar otomatik havuza transfer edilir
- Havuz, adaptore gelen istek oranina gore egiticilere dagitilir
- Egitici yeni adaptoru yayinlamak icin coin stake etmek zorundadir (slash riski)
- Dusuk benchmark skoru alan adaptordan stake yakılır (slash), adaptör reddedilir

## **2.3 Testnet / Mainnet Gecisi**

Cold start problemi kapali testnet + lockup mekaizmasiyla cozulur:

- Testnet donemi: sadece egiticiler davet edilir, kazanilan coinler kontrat seviyesinde kilitlidir
- Lockup takvimi: mainnet acilisinin 0. gunu %25, 90. gun %25, 180. gun %25, 270. gun %25
- Testnet bittigi anda sistemde binlerce onaylanmis adaptor ve dagitilmis coin stoku olmasi beklenir
- Coin listesi: minerlar onceden bilgilendirilir; ani satis basinci lockup ile yumusatilir

# **3\. Cok Ajanli Gelistirme Mimarisi**

Proje 7 uzmanlik ajaniyla yurutulur. Her ajan bagimsiz bir alan uzerinde calisir; Orchestrator tum koordinasyonu yonetir. Ajanlar Cursor uzerinde calisiyor; Orchestrator manuel handoff protokoluyle yonetilir.

| **Ajan**     | **Sorumluluk Alani**                   | **Teknoloji Stack**                       |
| ------------ | -------------------------------------- | ----------------------------------------- |
| ORCHESTRATOR | Koordinasyon, karar, sprint planlama   | Markdown protokol, context yonetimi       |
| AGENT-BC     | Blockchain & akilli kontratlar         | Sui Move, Sui SDK, TypeScript             |
| AGENT-AI     | Model entegrasyonu & benchmark sistemi | Python, BitNet, PEFT/LoRA, FastAPI        |
| AGENT-BE     | Backend API & is mantigI               | Node.js, Fastify, PostgreSQL, Redis       |
| AGENT-FE     | Frontend & kullanici arayuzu           | Next.js 14, TypeScript, Tailwind, Zustand |
| AGENT-INF    | Altyapi, DevOps & IPFS entegrasyonu    | Docker, Kubernetes, IPFS/Filecoin, CI/CD  |
| AGENT-SEC    | Guvenlik, audit & tokenomics dogrulama | Sui auditing, pen-test, kontrat analizi   |

## **3.1 Orchestrator Sorumluluklari**

- Sprint basinda her ajana gorev atar (markdown prompt bloklari halinde)
- Ajanlar arasi bagimliliklari takip eder (BC bitmeden BE baslamamali gibi)
- Her faz sonunda entegrasyon kontrolu yapar
- Mimari kararlar, oncelik degisiklikleri ve risk yonetimi Orchestrator'a aittir
- Teknik borcun birikimini haftalik izler ve sprint'e ekler

## **3.2 Ajan Haberlesme Protokolu**

Ajanlar birbirinin ciktilarini dogrudan okur, asenkron handoff markdown dosyalariyla yapilir:

- Her ajan teslim ettiginde /handoffs/{AGENT}-output.md olusturur
- Bagimlanan ajan bu dosyayi context olarak alir
- Orchestrator conflict durumunda araci karar verir
- Her sprint 1 haftalik; sprint sonu demo Orchestrator'a sunulur

# **4\. Faz Bazli Gelistirme Plani**

| **Faz**                 | **Sure**    | **Kapsam**                                                                    | **Cikti**                                   |
| ----------------------- | ----------- | ----------------------------------------------------------------------------- | ------------------------------------------- |
| Faz 0 - Temel           | Hafta 1-2   | Mimari kararlari, repo kurulumu, agent protokol tanimlama                     | Monorepo, CI/CD, agent rollari kesinlesti   |
| Faz 1 - Blockchain Core | Hafta 3-6   | Sui kontratlar: kayit, stake/slash, odul havuzu, R3MES coin                   | Testnet kontratlar canli, faucet aktif      |
| Faz 2 - AI Pipeline     | Hafta 5-9   | BitNet deploy, LoRA/DoRA pipeline, benchmark sistemi, IPFS entegrasyon        | Model IPFS'te, benchmark otomatik calisiyor |
| Faz 3 - Backend API     | Hafta 7-11  | REST/WebSocket API, auth (Sui wallet), kullanici yonetimi, inference endpoint | API dokumanlandi, staging'de canli          |
| Faz 4 - Frontend        | Hafta 9-13  | Marketplace, chat ekrani, stake arayuzu, dashboard                            | Beta UI testnet'e bagli                     |
| Faz 5 - Testnet         | Hafta 13-18 | Kapali testnet, miner onboarding, lockup kontrat, kalite filtresi             | Adaptorler birikti, coin dagitildi          |
| Faz 6 - Mainnet         | Hafta 18+   | Guvenlik audit, mainnet deployment, listing sureci, komunite acilisi          | R3MES canli, coin listelendi                |

## **Faz 0 - Temel Kurulum (Hafta 1-2)**

Butun ajanlar bu fazda eslesmeli calisir. Mimari kararlar sonradan degistirmek cok maliyetlidir.

- Monorepo kurulumu: /blockchain, /ai-pipeline, /backend, /frontend, /infra klasorleri
- CI/CD: GitHub Actions, her PR'da lint + test zorunlu
- Agent protokolu dokumantasyonu: her ajanin interface'i tanimlanir
- Ortam degiskenleri ve secret yonetimi: Vault veya GitHub Secrets
- Temel Docker Compose: lokal gelistirme ortami tum servislerle calisir

**Orchestrator Faz 0 Gorevi**

• ADR (Architecture Decision Record) dosyalarini olustur: blockchain secimi, model secimi, API tasarimi

• Her ajan icin ilk sprint gorevlerini hazirla

• Risk registrini ac: teknik, tokonomik, guvenlik riskleri ayri ayri izlensin

## **Faz 1 - Blockchain Core (Hafta 3-6)**

AGENT-BC ve AGENT-SEC bu fazda ana yuktadir. Diger ajanlar hazirlik yapar.

- AdaptorRegistry kontrati: upload, onay durumu, versiyon takibi
- StakingVault kontrati: stake, slash, lockup takvimi uygulamasi
- RewardPool kontrati: havuz bakiyesi, dagitim algoritmasi, claim mekanizmasi
- R3MESCoin: SUI'de fungible token, faucet testnet icin
- AGENT-SEC: her kontrati bagimsiz olarak inceler, test vektorleri yazar
- Testnet deploy: Sui Devnet uzerinde canli, explorer'da gorunur

## **Faz 2 - AI Pipeline (Hafta 5-9)**

AGENT-AI bu fazda calisir; Faz 1 ile paralel yurutulur.

- BitNet b1.58 modeli IPFS'e yuklenir, CID Sui'de kayitlanir
- LoRA/DoRA egitim scripti: standart JSONL input formati, otomatik validasyon
- Benchmark sistemi: alan bazli test setleri (Turkce genel, hukuk, tip, finans)
- Benchmark skoru hesaplama ve on-chain kayit mekanizmasi
- Inference API: FastAPI, adaptoru secip cevap uret, Sui wallet auth
- IPFS entegrasyon: adaptorler CID ile adreslanir, model hash dogrulama

## **Faz 3 - Backend API (Hafta 7-11)**

AGENT-BE bu fazda calisir; blockchain ve AI pipeline ile entegrasyon kritiktir.

- Fastify API: /adapters, /chat, /stake, /rewards endpoint'leri
- Sui wallet tabanlI auth: imza dogrulama, session yonetimi
- WebSocket chat: streaming inference response destegi
- PostgreSQL: kullanici profilleri, adaptör metadata, kullanim istatistikleri
- Redis: rate limiting, session cache, inference queue
- API dokumantasyonu: OpenAPI 3.1, Swagger UI

## **Faz 4 - Frontend (Hafta 9-13)**

AGENT-FE bu fazda calisir; Faz 3 ile paralel yurutulur.

- Next.js 14 App Router, TypeScript strict mode, Tailwind CSS
- Sui wallet entegrasyonu: Sui Wallet Kit, connect/disconnect, bakiye goruntuleme
- Marketplace: adaptorler listesi, alan filtresi, benchmark skoru gorunumu
- Chat ekrani: adaptoru sec, mesajlas, coin kesintisi goster
- Stake paneli: coin yatir/cek, lockup takvimi, kazanc ozeti
- Egitici paneli: adaptör yukle, benchmark sonucu izle, odul takibi

## **Faz 5 - Kapali Testnet (Hafta 13-18)**

Tum ajanlar bu fazda hata duzeltme ve performans optimizasyonuna odaklanir.

- Davetiye sistemi: egiticiler beyaz listeyle sisteme alinir
- Lockup kontrati canli: kazanilan coinler kilitlenir, takvim gosterilir
- Benchmark kalite filtresi: dusuk skorlu adaptorler otomatik reddedilir
- Yuk testi: 100+ egiticisi, 1000+ adaptör senaryosu
- Bug bash: tum ajanlar cross-alan test yapar
- Miner onboarding dokumani ve uyari bildirimleri hazirlanir

## **Faz 6 - Mainnet (Hafta 18+)**

- AGENT-SEC: tam guvenlik auditi, penetrasyon testi
- Mainnet Sui deployment, kontrat adresleri kilitlenir
- Coin listing sureci: CEX/DEX hazırligi
- Komunite acilisi: Discord, dukumantasyon sitesi, egitici rehberi
- Monitoring: on-chain event izleme, alarm sistemi, dashboard

# **5\. Kritik Teknik Kararlar**

## **5.1 Neden Sui?**

- Move VM: tip guvenligi sayesinde reentrancy gibi klasik kontrat aciklari yapisal olarak imkansiz
- Object-centric model: her adaptör, stake, odul havuzu birer Sui object - paralel islem mumkun
- Dusuk islem ucreti: cok sayida kucuk odeme (inference basi) Ethereum'da impraktik, Sui'de ucuz
- Gelistirici deneyimi: Move dilini ögrenme maliyeti var ama uzun vadede guvenlik kazanci saglar

## **5.2 Neden BitNet b1.58?**

- 1-bit agirliklar: RAM kullanimi dramatik duser, CPU'da bile makul cikаrim mumkun
- Merkeziyetsizlikle uyumlu: guclu GPU'su olmayan egitici dugumleri de adaptorlerini calistirabilir
- Dondurulmus temel: herkes ayni noktadan baslAr, rekabet sadece adaptore dayali

## **5.3 LoRA vs DoRA**

- LoRA: daha yalin, genis ekosistem destegi, dusuk bellek gereksinimi
- DoRA: agirlik normunu ayri ogrenerek genellikle LoRA'dan daha iyi kalite
- Karar: platform her ikisini de kabul eder, benchmark sonucu konusar

## **5.4 Benchmark Sistemi Tasarimi**

Benchmark sistemi manipulasyona karsi en kritik savunma hatidir.

- Her alan icin (Turkce genel, tip, hukuk, finans, yazilim) ayri test seti
- Test setleri kamuya acik degil - adaptoru goren egitici ezberleme yapamaz
- Skor: BLEU + insan degerlendiricisi icin random ornekleme (baslangicta BLEU yeterli)
- Minimum gecme skoru: alan bazinda belirlenir, alttakiler slash'e gider
- Skor on-chain kayitlidir: herkes adaptörün tarihsel performansini gorebilir

# **6\. Risk Yonetimi**

**Yuksek Risk - Kontrat Guvenligi**

• Slash mekanizmasindaki bir bug kullanici fonlarini yakabilir

• Onlem: Faz 1'de AGENT-SEC bagimsiz audit yapar, mainnet oncesi ikinci audit zorunlu

• Testte: fuzzing ile anormal girdiler denenır, formal verification degerlendirilir

**Orta Risk - Cold Start Kalitesi**

• Testnet'te dusuk kaliteli adaptorler birikirse mainnet itibarı zarar gorur

• Onlem: Benchmark filtresi testnet'ten itibaren aktif olmali

• Testte: minimum 50 onaylanmis adaptör olmadan mainnet acilmaz

**Dusuk Risk - Coin Likidite**

• Lockup bitse bile miner satisi coinı dusürebilir

• Onlem: Chat kullanimi organik talebi canli tutar, lockup takvimi bildirimle yonetilir

• Testte: tokenomics simulasyonu Faz 5'te yapilir

# **7\. Monorepo Dosya Yapisi**

Onerilen klasor yapisi:

| **Yol**                | **Sorumluluk / Icerik**                              |
| ---------------------- | ---------------------------------------------------- |
| /blockchain            | Sui Move kontratlar - AGENT-BC                       |
| /blockchain/sources    | AdaptorRegistry, StakingVault, RewardPool, R3MESCoin |
| /blockchain/tests      | Move unit testleri, entegrasyon testleri             |
| /ai-pipeline           | Model ve egitim kodlari - AGENT-AI                   |
| /ai-pipeline/model     | BitNet yukleyici, IPFS push, hash dogrulama          |
| /ai-pipeline/training  | LoRA/DoRA fine-tune scripti, JSONL validasyon        |
| /ai-pipeline/benchmark | Test setleri (gizli), skor hesaplama, on-chain kayit |
| /ai-pipeline/inference | FastAPI server, adaptör secimi, streaming response   |
| /backend               | Node.js API - AGENT-BE                               |
| /backend/src/routes    | /adapters, /chat, /stake, /rewards                   |
| /backend/src/services  | Sui client, IPFS client, inference proxy, auth       |
| /frontend              | Next.js app - AGENT-FE                               |
| /frontend/app          | App router: marketplace, chat, stake, egitici        |
| /frontend/components   | UI bilesenleri, wallet hook, adaptör kartlari        |
| /infra                 | Altyapi kodlari - AGENT-INF                          |
| /infra/docker          | Compose dosyalari, Dockerfile'lar                    |
| /infra/k8s             | Kubernetes manifests                                 |
| /infra/ci              | GitHub Actions workflow'lari                         |
| /handoffs              | Ajan cikti dosyalari - Orchestrator okur             |
| /docs/adr              | Architecture Decision Records                        |

# **8\. MVP Tanimi - Ilk Canlilik**

MVP sunlari kapsar ve sunlari kapsamaz. Kapsam kaymasini onlemek icin bu liste Orchestrator'in birincil referansidir.

| **MVP KAPSAR**                          | **MVP KAPSAMAZ**                   |
| --------------------------------------- | ---------------------------------- |
| Sui'de R3MES coin ve temel kontratlar   | Governance / oy mekanizmasi        |
| LoRA/DoRA yukle ve benchmark            | Cok dilli arayuz (Ingilizce sonra) |
| Otomatik slash / odul dagitimi          | Mobil uygulama                     |
| Basit chat ekrani (adaptör sec + konус) | Gelismis analitik dashboard        |
| Stake ve lockup arayuzu                 | CEX listing (mainnet sonrasi)      |
| Egitici paneli (yukle, izle, kazan)     | Sosyal ozellikler (profil, takip)  |
| IPFS model + adaptör depolama           | Kendi token swap arayuzu           |

# **9\. Baslangic - Ilk 2 Hafta Gorev Listesi**

Orchestrator bu listeyi Faz 0'da tamamlatir. Siralama kritik, atlanmaz.

- Monorepo olustur, her ajan klasorunu hazirla
- GitHub Actions CI kurul: lint + test her PR'da
- AGENT-BC: Sui gelistirme ortamini kur, Move Hello World deploy et
- AGENT-AI: BitNet modeli yukle, lokal inference calistir
- AGENT-BE: Fastify boilerplate, health check endpoint
- AGENT-FE: Next.js 14 kurulum, Sui Wallet Kit baglantisi
- AGENT-INF: Docker Compose tum servisleri ayaga kaldirir
- AGENT-SEC: Tehdit modeli belgesi hazirla
- Orchestrator: ADR-001 (Sui secimi), ADR-002 (BitNet secimi), ADR-003 (API tasarimi)
- Tum ajanlar: ilk handoff dosyalarini yazar, Orchestrator incelemesi yapar

**R3MES - Plani net, hedefi net, kapsam sabit.**

Karmasiklik degil, derinlik.