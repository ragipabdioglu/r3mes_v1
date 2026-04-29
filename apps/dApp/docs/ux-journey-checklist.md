# Faz 7 — MVP kullanıcı yolculuğu (Pazaryeri → Chat → Stake → Studio)

**Amaç:** Temel akışlar açıklama olmadan tamamlanabilsin. Backend ayakta; gerçek tarayıcıda bu listeyi işaretleyin.

## Ortak

- Cüzdan yok: tek tip yönlendirme (üst menü + ilgili kısa metin).
- İmza iptal: uyarı tonu; `auth.signCancelled` ile tutarlı mesaj.
- Ağ hatası: liste/mutasyon mesajları aynı ürün dilinde.
- 501 / NOT_IMPLEMENTED: stake geri bildiriminde **uyarı** (amber).

## 1. Pazaryeri (`/`)

- Liste veya boş durum net; boşta Studio linki çalışıyor.
- Kart → Chat: `adapter` (+ varsa `cid`) doğru.

## 2. Chat (`/chat`)

- Adaptör yokken uyarı + Pazaryeri linki.
- Gönder → yanıt akışı veya beklenen hata.
- İmza iptal: metin ve giriş geri geliyor.

## 3. Stake (`/stake`)

- Özet / ödül yükleme ve hata durumları okunaklı.
- Stake / claim geri bildirimi (başarı / 501 / imza / ağ) doğru tonda.

## 4. Studio (`/studio`)

- Cüzdan uyarısı; yükleme ve liste boş/ dolu durumları.

## 5. Yan kart (pazaryeri)

- Bakiye: bağlı değil / yükleniyor / hata metinleri tutarlı.