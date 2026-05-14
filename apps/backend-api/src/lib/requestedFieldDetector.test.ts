import { describe, expect, it } from "vitest";

import { detectRequestedFields } from "./requestedFieldDetector.js";

describe("detectRequestedFields", () => {
  it("detects KAP requested numeric fields and output constraints", () => {
    const result = detectRequestedFields(
      "EREGL 1578858 Türkçe kar dağıtım tablosunda dağıtılması öngörülen diğer kaynaklar ve olağanüstü yedekler hangi rakamlarla geçiyor? Sadece sorulan rakamları kısa maddelerle yaz; risk yorumu ekleme.",
    );

    expect(result.requestedFields.map((field) => field.id)).toEqual(
      expect.arrayContaining(["diger_kaynaklar", "olaganustu_yedekler"]),
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
      expect.arrayContaining(["diger_kaynaklar", "olaganustu_yedekler"]),
    );
    expect(result.requestedFields.map((field) => field.id)).not.toContain("net_donem_kari");
  });

  it("detects stopaj and share/cash rate table intents", () => {
    const stopaj = detectRequestedFields("FROTO B ve C grubu için stopaj oranları ne?");
    expect(stopaj.requestedFields.map((field) => field.id)).toContain("stopaj_orani");

    const cashRate = detectRequestedFields("KCHOL A Grubu ve B Grubu için nakit tutarı ve oran satırları ne?");
    expect(cashRate.requestedFields.map((field) => field.id)).toContain("nakit_tutar_oran");
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
});
