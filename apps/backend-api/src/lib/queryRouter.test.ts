import { describe, expect, it } from "vitest";

import { routeQuery } from "./queryRouter.js";

describe("routeQuery", () => {
  it("routes medical questions into domain and subtopic scopes", () => {
    const plan = routeQuery("Smear sonucum temiz ama ara ara kasık ağrım oluyor");

    expect(plan.domain).toBe("medical");
    expect(plan.confidence).toBe("high");
    expect(plan.subtopics).toEqual(expect.arrayContaining(["smear", "kasik_agrisi"]));
    expect(plan.mustIncludeTerms).toEqual(expect.arrayContaining(["smear", "kontrol", "kasık"]));
  });

  it("routes baby sweating questions into pediatric sweating scope", () => {
    const plan = routeQuery("Bebeğim çok terliyor neden olabilir?");

    expect(plan.domain).toBe("medical");
    expect(plan.subtopics).toContain("pediatri_terleme");
    expect(plan.retrievalHints).toEqual(expect.arrayContaining(["bebek terlemesi", "ateş kontrolü"]));
    expect(plan.mustIncludeTerms).toEqual(expect.arrayContaining(["bebek", "terleme", "çocuk doktoru"]));
  });

  it("routes legal deposit questions without relying on medical evidence", () => {
    const plan = routeQuery("Ev sahibi depozitomu iade etmiyor, ne yapmalıyım?");

    expect(plan.domain).toBe("legal");
    expect(plan.subtopics).toContain("kira");
    expect(plan.retrievalHints).toEqual(expect.arrayContaining(["depozito iadesi"]));
  });

  it("routes family-law questions into legal divorce subtopics", () => {
    const plan = routeQuery("Boşanma davasında velayet ve nafaka için hangi belgelere dikkat etmeliyim?");

    expect(plan.domain).toBe("legal");
    expect(plan.confidence).toBe("high");
    expect(plan.subtopics).toEqual(expect.arrayContaining(["bosanma", "velayet", "nafaka"]));
    expect(plan.mustIncludeTerms).toEqual(expect.arrayContaining(["boşanma", "belge", "avukat"]));
  });

  it("routes inheritance and enforcement questions into legal scopes", () => {
    expect(routeQuery("Miras için veraset belgesi ve tereke konusunda ne yapmalıyım?")).toMatchObject({
      domain: "legal",
      subtopics: ["miras"],
    });
    expect(routeQuery("İcra ödeme emrine itiraz süresini kaçırmamak için neye bakmalıyım?")).toMatchObject({
      domain: "legal",
      riskLevel: "high",
    });
  });

  it("routes high-risk technical migration questions into a scoped technical plan", () => {
    const plan = routeQuery("Production veritabanında migration çalıştırmadan önce ne yapmalıyım?");

    expect(plan.domain).toBe("technical");
    expect(plan.subtopics).toContain("migration");
    expect(plan.riskLevel).toBe("high");
    expect(plan.mustIncludeTerms).toEqual(expect.arrayContaining(["migration", "yedek", "rollback"]));
  });

  it("routes finance and travel questions into separate non-medical scopes", () => {
    expect(routeQuery("Yüksek getiri garantisi veren yatırım ürünü mantıklı mı?")).toMatchObject({
      domain: "finance",
      subtopics: ["yatirim_riski"],
    });
    expect(routeQuery("Pasaport ve rezervasyon kontrolü için neye bakmalıyım?")).toMatchObject({
      domain: "general",
      subtopics: ["travel_document"],
    });
  });

  it("routes education questions into education subtopics", () => {
    expect(routeQuery("Sınav sonucuna itiraz etmek için süre ve resmi kılavuzda neye bakmalıyım?")).toMatchObject({
      domain: "education",
      subtopics: ["sinav"],
    });
    expect(routeQuery("Özel eğitim için RAM raporu ve BEP planı nasıl değerlendirilir?")).toMatchObject({
      domain: "education",
      subtopics: ["ozel_egitim"],
    });
    expect(routeQuery("Okul disiplin kurulunda veli olarak hangi belgeyi hazırlamalıyım?")).toMatchObject({
      domain: "education",
      subtopics: ["ogrenci_disiplini", "okul_yonetimi"],
    });
  });

  it("keeps unknown questions on a low-confidence general fallback", () => {
    const plan = routeQuery("Bugün kısa bir not yazabilir misin?");

    expect(plan.domain).toBe("general");
    expect(plan.confidence).toBe("low");
    expect(plan.subtopics).toEqual([]);
  });
});
