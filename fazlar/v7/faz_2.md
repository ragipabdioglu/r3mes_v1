Kod tabanı güncel; devQaBypass.ts içinde DEV_BYPASS_QA_DOMAIN_TAG = "r3mes:dev-test" (dApp ile hizalı olması için yorumlanmış). Aşağıdaki özet bu duruma göre.

Sonuç raporu (istenen format)
Soru	Cevap
Bu testte kullanılacak tek bypass ne?
R3MES_DEV_BYPASS_QA=1 + NODE_ENV=development veya test. Yalnızca POST /v1/adapters ile yüklenen adapter için geçerli; kuyruk çağrılmaz, QA webhook beklenmez.
Başka hangi bypass kapalı kalmalı?
Indexer: SKIP_BENCHMARK_QUEUE — zincir olayından gelen benchmark atlaması; bu REST upload + chat dumanı testiyle aynı şey değil. Karışıklığı önlemek için indexer’da SKIP_BENCHMARK_QUEUE=0 (veya tanımsız) bırakın; “tek yol” algısı için benchmark’ı API tarafında yine yalnızca R3MES_DEV_BYPASS_QA ile yönettiğinizi varsayın. Backend: R3MES_MIRROR_LIST_QUEUE upload’u ikinci bir “atlatma” olarak kullanmayın (bypass açıkken zaten enqueueBenchmarkJob yok). Chat ücreti için isteğe bağlı R3MES_SKIP_CHAT_FEE=1 (yalnızca yerel; üretimde kapalı) — bu “benchmark bypass” değil, Sui ücreti kolaylığı.
Backend yeni upload için hazır mı?
Evet, şu koşullarla: API ayakta (/health), DATABASE_URL, IPFS (IPFS_API_URL), R3MES_DEV_BYPASS_QA=1, NODE_ENV=development, cüzdan için R3MES_SKIP_WALLET_AUTH + R3MES_DEV_WALLET veya gerçek imza; chat için R3MES_AI_ENGINE_URL (ve gerekirse R3MES_SKIP_CHAT_FEE=1).
Upload sonrası beklenen durum ne?
status=ACTIVE, benchmarkScore=null, domainTags içinde r3mes:dev-test, yanıtta devQaBypassApplied: true, benchmarkJobId sentinel: dev-bypass-qa. Liste/chat: ACTIVE olduğu için chat çözümü çalışır (AI engine ayakta olmalı).
Tek cümle
Bu deneme için resmi tek “benchmark’ı atlayıp ACTIVE yap” yolu backend’de R3MES_DEV_BYPASS_QA=1; indexer SKIP_BENCHMARK_QUEUE bunun paraleli değil, ayrı süreç — bu testte kullanmayın / kapalı tutun ki sonuç tek kanaldan okunabilsin.

Başarı kriteri: Tek upload → yukarıdaki alanlar tutarlı → chat zinciri benchmark kalitesinden bağımsız doğrulanır; ikinci bir bypass ile sonuç karışmaz.

----------------

Doğrulama (önceki durum)
Katman	Değer
Backend (devQaBypass.ts)
dev_bypass_qa
Frontend (r3mes-fe-contract.ts)
r3mes:dev-test
Bu ikisi eşleşmiyordu — yeni yüklenen test LoRA’sı ACTIVE olsa bile pill / chat uyarısı çıkmıyordu.

Yapılan hizalama
apps/backend-api/src/lib/devQaBypass.ts — DEV_BYPASS_QA_DOMAIN_TAG artık r3mes:dev-test (dApp R3MES_DEV_TEST_DOMAIN_TAG ile aynı).
apps/dApp/lib/types/adapter-dev-test.ts — Eski yerel kayıtlar için dev_bypass_qa hâlâ tanınıyor (geri uyumluluk).
Sonuç raporu
Tag adı hizalı mı?
Evet — yeni upload’larda backend ve FE kanonik olarak r3mes:dev-test kullanıyor. Eski satırlar için FE dev_bypass_qa okuyor.
Marketplace hazır mı?
Evet — GET /v1/adapters?status=ACTIVE + bu tag ile kartta dev test pill’i ve gri Skor — davranışı tetiklenir.
Chat yüzeyi hazır mı?
Evet — GET /v1/adapters/:id ile gelen domainTags üzerinden aynı mantık; dev test + kısa “benchmark onayı yok” metni.
Kullanıcı şimdi upload ederse doğru görünür mü?
Evet — R3MES_DEV_BYPASS_QA=1 ve dev/test ortamında upload sonrası tag r3mes:dev-test yazılır; marketplace ve chat FE ile uyumlu.
Not: Üretimde isDevQaBypassEnabled() zaten kapalı; bu akış yalnızca dev/test için geçerli.

-------------

