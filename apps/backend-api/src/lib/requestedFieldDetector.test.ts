import { describe, expect, it } from "vitest";

import { detectRequestedFields } from "./requestedFieldDetector.js";

describe("detectRequestedFields", () => {
  it("detects requested numeric fields and output constraints without domain aliases", () => {
    const result = detectRequestedFields(
      "EREGL 1578858 Türkçe kar dağıtım tablosunda dağıtılması öngörülen diğer kaynaklar ve olağanüstü yedekler hangi rakamlarla geçiyor? Sadece sorulan rakamları kısa maddelerle yaz; risk yorumu ekleme.",
    );

    expect(result.requestedFields.map((field) => field.id)).toEqual(
      expect.arrayContaining(["dagitilmasi_ongorulen_diger_kaynaklar", "olaganustu_yedekler"]),
    );
    expect(result.constraints.forbidCaution).toBe(true);
    expect(result.constraints.noRawTableDump).toBe(true);
    expect(result.constraints.format).toBe("bullets");
  });

  it("does not treat explicitly excluded table fields as requested fields", () => {
    const result = detectRequestedFields(
      "Dağıtılması öngörülen diğer kaynaklar ve olağanüstü yedekler yaz. Net dönem kârı satırıyla karıştırma.",
    );

    expect(result.requestedFields.map((field) => field.id)).toEqual(
      expect.arrayContaining(["dagitilmasi_ongorulen_diger_kaynaklar", "olaganustu_yedekler"]),
    );
    expect(result.requestedFields.map((field) => field.id)).not.toContain("net_donem_kari");
  });

  it("detects stopaj and share/cash rate table intents", () => {
    const stopaj = detectRequestedFields("FROTO B ve C grubu için stopaj oranları ne?");
    expect(stopaj.requestedFields.map((field) => field.id)).toContain("stopaj_oranlari");

    const cashRate = detectRequestedFields("KCHOL A Grubu ve B Grubu için nakit tutarı ve oran satırları ne?");
    expect(cashRate.requestedFields.map((field) => field.id)).toEqual(
      expect.arrayContaining(["nakit_tutari", "oran"]),
    );
    expect(cashRate.requestedFields.map((field) => field.id)).not.toContain("kchol_a_grubu");
  });

  it("prioritizes explicit list/bullet formatting over generic table wording", () => {
    const result = detectRequestedFields(
      "FROTO kar dağıtım tablosunda A, B ve C grupları için nakit tutarı ve oranları hangi satırlarda geçiyor? Kısa maddelerle yaz, ham tablo basma.",
    );

    expect(result.requestedFields.map((field) => field.id)).toEqual(
      expect.arrayContaining(["nakit_tutari", "oranlari"]),
    );
    expect(result.constraints.format).toBe("bullets");
  });

  it("does not split nested net period profit into a second generic period profit request", () => {
    const result = detectRequestedFields("SPK'ya göre net dönem kârı kaç? Yasal kayıtlarla karıştırmadan kısa açıkla.");

    expect(result.requestedFields.map((field) => field.id)).toEqual(["net_donem_kari"]);
  });

  it("keeps generic and net period profit when both are explicitly requested", () => {
    const result = detectRequestedFields("SPK'ya göre dönem kârı ve net dönem kârı hangi rakamlarla geçiyor?");

    expect(result.requestedFields.map((field) => field.id)).toEqual(
      expect.arrayContaining(["donem_kari", "net_donem_kari"]),
    );
  });

  it("does not turn output instructions into requested fields", () => {
    const shareGroups = detectRequestedFields("A Grubu ve B Grubu için nakit tutarı ve oran satırlarını bu iki grubu maddelerle yaz.");
    expect(shareGroups.requestedFields.map((field) => field.id)).toEqual(
      expect.arrayContaining(["nakit_tutari", "oran"]),
    );
    expect(shareGroups.requestedFields.map((field) => field.id)).not.toContain("bu_iki_grubu_maddelerle");
    expect(shareGroups.requestedFields.map((field) => field.id)).not.toContain("oran_satirlarini_bu_iki_grubu");

    const noMixing = detectRequestedFields("SPK'ya göre net dönem kârı kaç? EREGL rakamlarını kullanma, tek satır cevap.");
    expect(noMixing.requestedFields.map((field) => field.id)).toContain("net_donem_kari");
    expect(noMixing.requestedFields.map((field) => field.id)).not.toContain("eregl_rakamlarini_kullanma_tek_satir_cevap");
  });

  it("keeps row value requests while ignoring generic result instructions", () => {
    const result = detectRequestedFields(
      "Tabloda dağıtılması öngörülen diğer kaynaklar satırı kaç görünüyor? Başka satırı cevap sanma. Sadece sonucu yaz.",
    );

    expect(result.requestedFields.map((field) => field.id)).toContain("dagitilmasi_ongorulen_diger_kaynaklar");
    expect(result.requestedFields.map((field) => field.id)).not.toContain("sonucu");
  });

  it("does not convert inflected comparison subjects into requested fields", () => {
    const result = detectRequestedFields("İki yaklaşımın farklarını tablo olarak ver.");

    expect(result.requestedFields).toEqual([]);
    expect(result.constraints.format).toBe("table");
  });
});
