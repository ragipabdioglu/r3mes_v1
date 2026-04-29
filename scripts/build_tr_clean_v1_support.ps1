$ErrorActionPreference = "Stop"

$outDir = "C:\Users\rabdi\OneDrive\Masaüstü\R3MES\infrastructure\lora-trials\candidates\2026-04-19_tr-clean-v1\train"
$outFile = Join-Path $outDir "tr-conversations-clean-v1-support.jsonl"
$notesFile = Join-Path $outDir "SUPPORT_NOTES.md"

$variants = @(
  { param($q) $q },
  { param($q) "Kısaca açıkla: $q" },
  { param($q) "Tek cümlede anlat: $q" },
  { param($q) "Bir cümleyle özetle: $q" },
  { param($q) "Bu kavram neden önemlidir? $q" },
  { param($q) "Bu terim ne işe yarar? $q" }
)

$pairs = @(
  @{ q = "LoRA nedir?"; a = "LoRA, büyük modeli az sayıda ek parametreyle verimli biçimde uyarlayan ince ayar yöntemidir." },
  @{ q = "Adapter ne işe yarar?"; a = "Adapter, temel modeli değiştirmeden yeni görev davranışı eklemek için kullanılan küçük uyarlama katmanıdır." },
  @{ q = "GGUF formatı neden kullanılır?"; a = "GGUF, modeli ve meta veriyi tek taşınabilir dosyada tutarak farklı çalıştırma ortamlarında kullanımı kolaylaştırır." },
  @{ q = "Quantization ne demektir?"; a = "Quantization, model ağırlıklarını daha düşük hassasiyetle saklayarak bellek ve hız maliyetini azaltma işlemidir." },
  @{ q = "Inference ne anlama gelir?"; a = "Inference, eğitilmiş modelin yeni bir girdiye cevap üretme aşamasıdır." },
  @{ q = "Fine-tuning ile inference arasındaki fark nedir?"; a = "Fine-tuning modelin öğrenme aşamasıdır, inference ise modelin cevap verdiği kullanım aşamasıdır." },
  @{ q = "Tokenizer neden önemlidir?"; a = "Tokenizer, metni modelin işleyebileceği parçalara ayırdığı için doğru ve verimli çalışmanın temelidir." },
  @{ q = "Prompt nedir?"; a = "Prompt, modele verilen girdidir; modelin ne yapacağını ve hangi üslupta cevap vereceğini yönlendirir." },
  @{ q = "Context window neyi ifade eder?"; a = "Context window, modelin tek seferde dikkate alabileceği toplam bağlam uzunluğunu ifade eder." },
  @{ q = "Latency ne demektir?"; a = "Latency, bir isteğin modele ulaşıp yanıtın dönmesine kadar geçen süredir." },
  @{ q = "Throughput neyi ölçer?"; a = "Throughput, modelin birim zamanda kaç istek veya token işleyebildiğini ölçer." },
  @{ q = "Model ağırlıkları ne demektir?"; a = "Model ağırlıkları, modelin öğrendiği sayısal parametrelerdir ve davranışı doğrudan belirler." },
  @{ q = "IPFS CID neyi ifade eder?"; a = "CID, içeriğe göre adreslenen ve değişmez bir içerik tanımlayıcısıdır." },
  @{ q = "IPFS neden içerik adresleme kullanır?"; a = "IPFS, veriyi konumuna göre değil içeriğinin özetiyle tanımlayarak doğrulanabilir ve değişmez adresleme sağlar." },
  @{ q = "Blockchain nedir?"; a = "Blockchain, kayıtların merkezi olmayan yapıda bloklar halinde zincir şeklinde tutulduğu dağıtık defter teknolojisidir." },
  @{ q = "Konsensüs mekanizması ne işe yarar?"; a = "Konsensüs mekanizması, ağdaki düğümlerin ortak defter durumu üzerinde anlaşmasını sağlayan kurallar kümesidir." },
  @{ q = "Doğrulama neden gerekir?"; a = "Doğrulama, modelin veya zincirin beklenen davranışı gerçekten üretip üretmediğini anlamak için gerekir." },
  @{ q = "Benchmark neyi ölçer?"; a = "Benchmark, modelin belirli bir görev kümesinde ne kadar iyi performans verdiğini ölçer." },
  @{ q = "Evaluation ile training arasındaki fark nedir?"; a = "Training modeli günceller, evaluation ise mevcut modelin ne kadar iyi çalıştığını ölçer." },
  @{ q = "Kısa ve doğru cevap neden önemlidir?"; a = "Kısa ve doğru cevap, kullanıcıya gereksiz yük bindirmeden net bilgi vermek için önemlidir." },
  @{ q = "Türkçe cevap kalitesi nasıl anlaşılır?"; a = "Türkçe cevap kalitesi, akıcılık, doğruluk, tutarlılık ve doğal ifade birleşimiyle anlaşılır." },
  @{ q = "Neden aynı soruya aynı cevap verilmemeli?"; a = "Model aynı soruya kör tekrar yapıyorsa genellikle ezber veya kalite sorunu vardır." },
  @{ q = "Chat smoke test ne için kullanılır?"; a = "Chat smoke test, modelin temel sohbet zincirinin çalışıp çalışmadığını hızlıca görmek için kullanılır." },
  @{ q = "Special token sızıntısı neden kötüdür?"; a = "Special token sızıntısı, modelin ham iç formatını kullanıcıya açtığını ve kalite sorunu olduğunu gösterir." },
  @{ q = "Sadece benchmark geçmek yeterli midir?"; a = "Hayır, benchmark tek başına yeterli değildir; modelin gerçek sohbet kalitesi de ayrıca görülmelidir." },
  @{ q = "LoRA neden küçük veriyle de işe yarayabilir?"; a = "LoRA, yalnızca sınırlı sayıda parametreyi güncellediği için küçük ama hedefli veriyle hızlı uyum sağlayabilir." },
  @{ q = "Adapter eğitimi ana modeli nasıl korur?"; a = "Adapter eğitimi ana ağırlıkları değiştirmediği için temel model davranışını bozma riskini azaltır." },
  @{ q = "Düşük rank ne demektir?"; a = "Düşük rank, güncellemenin daha küçük bir uzayda öğrenilmesi demektir; bu da eğitimi hafifletir." },
  @{ q = "Modeli neden quantize ederiz?"; a = "Modeli daha az bellekle çalıştırmak ve çıkarımı hızlandırmak için quantize ederiz." },
  @{ q = "Neden GGUF seçiliyor?"; a = "GGUF, çıkarım araçlarıyla uyumlu paketleme sunduğu için dağıtım ve test süreçlerini kolaylaştırır." }
)

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$rows = New-Object System.Collections.Generic.List[object]
foreach ($pair in $pairs) {
  foreach ($variant in $variants) {
    $prompt = & $variant $pair.q
    $rows.Add(@{
      messages = @(
        @{ role = "user"; content = $prompt },
        @{ role = "assistant"; content = $pair.a }
      )
    })
  }
}

if ($rows.Count -ne 180) {
  throw "Expected 180 rows, got $($rows.Count)"
}

Remove-Item $outFile -Force -ErrorAction SilentlyContinue
foreach ($row in $rows) {
  ($row | ConvertTo-Json -Depth 6 -Compress) | Add-Content -Encoding utf8 $outFile
}

@'
# `tr-clean-v1` destek veri notu

- Kaynak: elle yazılmış Türkçe teknik çekirdek temalar
- Toplam: 180 örnek
- Format: `messages` JSONL
- Amaç: kısa, doğal, teknik Türkçe cevap davranışını güçlendirmek
- İçerik: LoRA, adapter, GGUF, quantization, tokenizer, prompt, inference, fine-tuning, IPFS, CID, blockchain, consensus
- Yasak: roleplay, genel kültür, uzun anlatım, İngilizce ağırlık
'@ | Set-Content -Encoding utf8 $notesFile

Write-Host "Wrote $outFile"
Write-Host "Wrote $notesFile"
