TAMAMLANDI
Ne yapıldı

useSignPersonalMessage ile lib/hooks/use-r3mes-wallet-auth.ts içinde ensureAuthHeaders() eklendi: mesaj R3MES Auth: <Date.now()> (UTF-8), imza sonucu X-Signature, düz metin X-Mesaj → X-Message, adres X-Wallet-Address olarak dönüyor.
LocalStorage önbelleği (lib/api/wallet-auth-cache.ts): cüzdan adresi başına anahtar, message + signature + expiresAt; getAuthTtlMs() ile varsayılan 24 saat (NEXT_PUBLIC_R3MES_AUTH_TTL_MS ile değiştirilebilir). Süre dolunca veya forceRefresh ile kayıt silinip yeniden imza istenir.
lib/api/chat-stream.ts: POST öncesi auth: R3mesWalletAuthHeaders zorunlu; başlıklar fetch’e eklenir; isteğe bağlı x-r3mes-wallet korunur. Çıkarım URL’si getAiEngineUrl() (NEXT_PUBLIC_AI_ENGINE_URL, varsayılan http://localhost:8000) ile hizalandı.
lib/api/post-adapters.ts: postAdaptersMultipart(formData, auth) — multipart gövdeye dokunmadan yalnızca X-Signature / X-Message / X-Wallet-Address eklenir.
components/chat-screen.tsx: her gönderimde önce ensureAuthHeaders(); önbellek geçerliyse ek imza penceresi yok.
components/studio-upload-panel.tsx: cüzdan zorunlu; yüklemeden önce ensureAuthHeaders() + postAdaptersMultipart.
lib/api/wallet-auth-message.ts, lib/api/wallet-auth-types.ts, lib/env.ts (getAuthTtlMs), .env.example (TTL notu).
Test senaryoları (manuel / derleme)

pnpm --filter @r3mes/dapp build — başarılı (tip kontrolü geçti).
Davranış: ilk istekte cüzdan imzası; localStorage doluyken ve TTL içinde tekrar isteklerde imza tekrarı beklenmez; cüzdan değişince farklı cache anahtarı; TTL dolunca veya önbellek boşsa yeniden imza.
BAĞIMLILIK
Backend / AI: X-Signature, X-Message, X-Wallet-Address ile imza doğrulama (Sui personal message / base64 imza ve mesaj eşlemesi). Chat isteği artık AI motoru URL’sine gidiyor; proxy kullanıyorsanız NEXT_PUBLIC_AI_ENGINE_URL ile aynı yolu verin.
Güvenlik: Önbellekteki imza belirli bir mesaj + zaman damgası içindir; backend’in bu başlıkları kendi politikasına göre doğrulaması gerekir.
ENGEL
YOK (derleme geçti). Not: kök ESLint 9 ile next lint uyumu önceki fazdaki gibi ignoreDuringBuilds ile ayrılmış olabilir.

SONRAKİ ADIM ÖNERİSİ
Backend’de 401/403 döndüğünde önbelleği temizleyip ensureAuthHeaders({ forceRefresh: true }) ile otomatik yeniden imza akışı; mümkünse shared-types ile başlık/imza şemasını netleştirmek.

---------------------------------------------------------------------------------------

TAMAMLANDI: apps/backend-api/src/lib/walletAuth.ts içinde Fastify preHandler olarak kullanılan walletAuthPreHandler eklendi: X-Signature, X-Message, X-Wallet-Address okunuyor; mesaj UTF-8 veya base64: önekli ham bayt; JSON’da zorunlu exp (unix saniye veya ms) ve isteğe bağlı iat / address ile süre ve adres tutarlılığı kontrol ediliyor; @mysten/sui/verify içindeki verifyPersonalMessageSignature ile imza doğrulanıyor (Ed25519 / Secp256k1 vb. seri imza formatı). Başarıda req.verifiedWalletAddress set ediliyor. POST /v1/chat/completions (chatProxy.ts) ve POST /v1/adapters + /adapters (adapters.ts) bu preHandler ile korunuyor; multipart’ta isteğe bağlı wallet alanı imzalı adresle çelişirse 403. CORS’a imza başlıkları eklendi (app.ts). Yerel bypass: yalnızca R3MES_SKIP_WALLET_AUTH=1 + R3MES_DEV_WALLET. .env.example güncellendi. Birim testleri: src/walletAuth.test.ts.

BAĞIMLILIK: Frontend: her POST’ta aynı baytları imzalayıp üç başlığı göndermeli; X-Message JSON şeması (exp, isteğe bağlı iat, address) ile uyum. Dokümantasyon / Orchestrator: istemci örnek akışı (challenge mesajı üretimi, süre).

ENGEL: YOK

SONRAKİ ADIM ÖNERİSİ: Üretimde R3MES_SKIP_WALLET_AUTH kullanmayın; Frontend’de nonce + sunucu challenge ile tekrar kullanımı (replay) ek olarak ele alın; gerekirse /v1/internal/* için ayrı HMAC/mTLS ile ayırın.