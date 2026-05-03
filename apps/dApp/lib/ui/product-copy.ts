/**
 * Tek tip ürün dili — teknik alan adı veya endpoint içermez.
 * API ile ilgili ipuçları yalnızca ortam / bağlantı düzeyindedir.
 */

export const QWEN_DEFAULT_RUNTIME_PUBLIC_LINE =
  "Varsayılan sohbet hattı Qwen2.5-3B; bilgi yanıtları seçili knowledge kaynaklarıyla güçlendirilir.";

export const backendUrlHint =
  "API adresini ortam değişkenleri üzerinden doğrulayın.";

export const loadingLabel = "Yükleniyor…";

export const walletConnectForStake =
  "Stake ve ödülleri görmek için cüzdanınızı bağlayın.";

/** Gönder’e basıldığında cüzdan yoksa — tek cümle aksiyon. */
export const walletConnectForChatAction =
  "Sohbet için üst menüden cüzdanı bağlayıp imza isteğini onaylayın.";

export const walletConnectForStudio =
  "Knowledge kaynaklarını ve çalışma alanınızı yönetmek için cüzdanınızı bağlayın.";

export const mutationCompleted = "İşlem sunucuda tamamlandı; özet aşağıda güncellendi.";

/** İmza / oturum — backend yanıtı değil; tek tonda gösterilir. */
export const auth = {
  walletRequired: "Bu işlem için cüzdan bağlantısı gerekir.",
  signCancelled: "İmza isteği iptal edildi. Aynı işlemi yeniden deneyin.",
  signFailed: "İmza alınamadı. Cüzdanı açıp yeniden deneyin.",
} as const;

/** Net sonraki adım — kullanıcıyı karar notuna değil aksiyona yönlendirir. */
export const journey = {
  stakeOnChain:
    "Gerçek stake ve ödül hareketlerini cüzdanınızdan veya protokol arayüzünden yapın.",
  rewardsOnChain:
    "Ödül almak için protokolün zincir üstü akışını kullanın.",
  refreshPage:
    "Bağlantı düzelince sayfayı yenileyin veya bir süre sonra tekrar deneyin.",
  uploadThenRefreshList:
    "Durumu görmek için alttaki listede «Yenile»ye basın.",
  modelUploadEntry:
    "Önce knowledge kaynağı yükleyin; isterseniz ayrıca davranış LoRA ekleyebilirsiniz.",
  connectWalletToUpload:
    "Yüklemeden önce cüzdanı bağlayıp imzayı onaylayın.",
  uploadFlowLead:
    "Knowledge önce private olarak kaydolur; hazır olduğunda public olarak yayımlanabilir.",
  uploadChatCta: "Sohbete git",
  uploadChatDisabledReason:
    "Knowledge hazır olmadan sohbette kaynak seçimi yapılamaz. Durumu üstteki knowledge listesinde izleyin.",
} as const;

export const pageIntro = {
  home:
    "Knowledge kaynaklarını, retrieval hattını ve opsiyonel behavior skill katmanını tek yerden izleyin. Ana akış: veri yükle, hazırla, kaynaklı sohbet et.",
  stake:
    "Stake ve ödül özetinizi izleyin. Kesin işlemler zincir ve cüzdan üzerinden yapılır; bu sayfa okuma ve deneme içindir.",
  studio:
    "Knowledge verisini yükleyin, indeks durumunu izleyin ve private/public görünürlüğü yönetin. Behavior LoRA yüzeyi ikincil ve yalnız stil/persona içindir.",
  chat:
    "Sohbet Qwen taban model üzerinde çalışır. Auto source modu uygun knowledge kaynaklarını seçer; behavior LoRA yalnız opsiyonel üslup katmanıdır.",
} as const;

export const marketplace = {
  emptyLine: "Listede behavior skill yok.",
  studioLinkLabel: "Studio’da behavior skill yükleyin",
} as const;

export const walletBalance = {
  connectPrompt: "R3MES bakiyesini görmek için cüzdanınızı bağlayın.",
  loadError: "Bakiye okunamadı. Ağ ve coin ayarını kontrol edin.",
} as const;

/** @see {@link module:@/lib/ui/r3mes-fe-contract} — metinler tek kaynakta */
export { studioUpload } from "@/lib/ui/r3mes-fe-contract";

export const chat = {
  adapterMissingLead:
    "Davranış LoRA opsiyoneldir. Doğrudan Qwen ile konuşabilir veya knowledge kaynakları ekleyebilirsiniz.",
  marketplaceLinkLabel: "Behavior library'den skill seçin",
  adapterMissingTail:
    "İsterseniz yukarıya adaptör kimliği ya da IPFS adresi de yazabilirsiniz.",
  adapterOnlyNote:
    "Yanıtlar seçtiğiniz knowledge kaynaklarıyla güçlendirilir. Davranış LoRA yalnız ton, rol ve persona içindir.",
  /** `r3mes:dev-test` veya env ID eşlemesi — kısa açıklama */
  devTestAdapterHint: "Yerel test kaydı; benchmark onayı yok.",
  emptyThreadNoAdapter:
    "İsterseniz knowledge kaynağı seçin, isterseniz doğrudan sohbet edin. Davranış LoRA zorunlu değildir.",
  emptyThread:
    "Mesajınızı yazıp Gönder’e basın; yanıt seçtiğiniz knowledge kaynakları ve opsiyonel behavior LoRA bağlamında üretilir.",
  preparingReply: "Yanıt hazırlanıyor…",
  roleUser: "Siz",
  roleAssistant: "Yanıt",
  networkError:
    "Sunucuya bağlanılamadı. Ağ ve API adresini kontrol edin.",
  streamFallback: "Yanıt tamamlanamadı. Aynı mesajı yeniden gönderin.",
  errorHint: "Sorun sürerse bağlantıyı ve adaptör alanlarını kontrol edin.",
  knowledgeSectionTitle: "Knowledge kaynakları",
  knowledgeSectionHint:
    "Varsayılan akış auto source modudur. İsterseniz kaynakları elle sınırlandırabilir veya public kaynakları dahil edebilirsiniz.",
  includePublicLabel: "Public knowledge dahil et",
  noKnowledgeSelected:
    "Seçili knowledge kaynağı yok. Bu durumda taban model veya davranış LoRA ile devam edilir.",
  sourceSectionTitle: "Kaynaklar",
  sourceFallback: "Bu yanıtta kaynak bilgisi dönmedi.",
} as const;

export const knowledgeStudio = {
  statusBoardTitle: "Knowledge koleksiyonları",
  uploadBoardTitle: "Knowledge yükleme",
  statusBoardHint:
    "Her yükleme önce private olarak kaydolur. Hazır olduğunda public olarak yayımlayabilirsiniz.",
  emptyState:
    "Henüz knowledge koleksiyonu yok. Aşağıdan ilk veri kaynağınızı yükleyin.",
  visibilityPublic: "Public",
  visibilityPrivate: "Private",
  publishAction: "Public yap",
  unpublishAction: "Private yap",
  documentsLabel: "Doküman",
  chunksLabel: "Chunk",
  updatedLabel: "Son güncelleme",
  publishedLabel: "Yayın",
  notPublished: "Yayınlanmadı",
  publishMutationError:
    "Görünürlük değiştirilemedi. Birkaç saniye sonra yeniden deneyin.",
  collectionNameLabel: "Koleksiyon adı",
  collectionNamePlaceholder: "Örn. Jinekolojik onkoloji kaynakları",
  documentTitleLabel: "Doküman başlığı (isteğe bağlı)",
  documentTitlePlaceholder: "Örn. Rehber özetleri",
  dropzoneTitle: "Knowledge dosyasını buraya sürükleyin veya seçin",
  dropzoneHelp:
    "MVP’de txt, md ve json desteklenir. Yükleme sonrası sistem dosyayı private olarak indeksler; public paylaşım ayrı karardır.",
  fileSelectLabel: "Dosya seç",
  fileListLabel: "Bilgi dosyası",
  privateFirstHint:
    "Yüklenen veri önce private kalır. Hazır olduğunda üstteki listeden public yapabilirsiniz.",
  validationNeedFileAndCollection:
    "Bir koleksiyon adı ve en az bir bilgi dosyası gerekir.",
  submitLabel: "Knowledge yükle",
  uploadSuccessFallback:
    "{name} koleksiyonu alındı. İndeksleme tamamlanınca listede durumu görebilirsiniz.",
  behaviorSectionTitle: "Behavior LoRA",
  behaviorSectionDescription:
    "Bu alan bilgi öğretmek için değil; rol, ton, persona, cevap stili ve agent davranışını ayarlamak için kullanılır.",
  behaviorListTitle: "Behavior LoRA kayıtları",
  behaviorUploadTitle: "Behavior LoRA yükleme",
} as const;
