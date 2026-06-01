import { describe, expect, it } from "vitest";

import {
  buildSourceDisplayModels,
  buildSuggestionDisplayModels,
  buildUserFacingStatus,
  sanitizeUserFacingReason,
} from "./publicChatDisplay.js";

describe("public chat display models", () => {
  it("maps citations to user-facing source display models", () => {
    const sources = buildSourceDisplayModels([
      {
        collectionId: "collection_1",
        documentId: "document_1",
        title: "Document title",
        chunkIndex: 2,
        excerpt: "Relevant evidence excerpt.",
      },
    ]);

    expect(sources).toEqual([
      {
        collectionId: "collection_1",
        documentId: "document_1",
        title: "Document title",
        chunkIndex: 2,
        excerpt: "Relevant evidence excerpt.",
        whyThisSource: "Cevapta kullanılan kanıt bu kaynaktan geldi.",
      },
    ]);
  });

  it("sanitizes technical score details from user-facing suggestion reasons", () => {
    expect(sanitizeUserFacingReason("Profile eşleşmesi (structured profile, skor 73): kavram."))
      .toBe("Profile eşleşmesi: kavram.");
    expect(sanitizeUserFacingReason("metadata profile score=88.5"))
      .toBe("metadata profile");
  });

  it("maps and dedupes source suggestions without exposing scores", () => {
    const suggestions = buildSuggestionDisplayModels([
      {
        id: "collection_1",
        name: "Suggested collection",
        reason: "Profile eşleşmesi (thin profile, skor 61): konu.",
      },
      {
        collectionId: "collection_1",
        title: "Duplicate collection",
        reason: "score 90",
      },
    ]);

    expect(suggestions).toEqual([
      {
        collectionId: "collection_1",
        title: "Suggested collection",
        reason: "Profile eşleşmesi: konu.",
        action: "select_collection",
      },
    ]);
  });

  it("builds minimal user-facing status without internal diagnostics", () => {
    expect(buildUserFacingStatus({ sourceCount: 1 })).toMatchObject({
      kind: "answered",
      sourceBacked: true,
    });
    expect(buildUserFacingStatus({ sourceCount: 0, noSource: true, suggestionCount: 2 })).toMatchObject({
      kind: "suggestions",
      sourceBacked: false,
    });
    expect(buildUserFacingStatus({ sourceCount: 1, safetyLimited: true })).toMatchObject({
      kind: "safety_limited",
      sourceBacked: true,
    });
  });
});
