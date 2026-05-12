import { describe, expect, it } from "vitest";

import { detectConversationalIntent } from "./conversationalIntent.js";

describe("detectConversationalIntent", () => {
  it("routes short greetings away from RAG", () => {
    const decision = detectConversationalIntent("Merhaba");

    expect(decision).toMatchObject({
      kind: "greeting",
      confidence: "high",
    });
  });

  it("does not steal real knowledge questions that start socially", () => {
    expect(detectConversationalIntent("Merhaba, smear sonucum temiz ama kasığım ağrıyor")).toBeNull();
    expect(detectConversationalIntent("Selam production migration öncesi ne yapmalıyım?")).toBeNull();
  });

  it("recognizes platform usage help", () => {
    const decision = detectConversationalIntent("Bu sistemi nasıl kullanırım?");

    expect(decision).toMatchObject({
      kind: "usage_help",
      confidence: "high",
    });
    expect(decision?.response).toContain("knowledge");
  });

  it("recognizes source and upload help without treating it as knowledge lookup", () => {
    expect(detectConversationalIntent("PDF nasıl yüklerim?")).toMatchObject({ kind: "usage_help" });
    expect(detectConversationalIntent("Kaynak nasıl seçerim?")).toMatchObject({ kind: "usage_help" });
    expect(detectConversationalIntent("R3MES nedir ve ne işe yarar?")).toMatchObject({ kind: "usage_help" });
  });

  it("keeps document knowledge requests in RAG when they ask for document content", () => {
    expect(detectConversationalIntent("Bu belgeyi kontrol eder misin?")).toBeNull();
    expect(detectConversationalIntent("PDF raporundaki LDL değeri nasıl?")).toBeNull();
  });
});
