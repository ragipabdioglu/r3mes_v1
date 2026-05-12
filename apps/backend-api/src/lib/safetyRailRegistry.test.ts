import { describe, expect, it } from "vitest";

import { getSafetyRailDefinition, listSafetyRailDefinitions } from "./safetyRailRegistry.js";

describe("safety rail registry", () => {
  it("keeps rail ids unique", () => {
    const definitions = listSafetyRailDefinitions();
    const ids = definitions.map((definition) => definition.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("classifies private scope mismatch as blocking privacy rail", () => {
    const definition = getSafetyRailDefinition("PRIVATE_SOURCE_SCOPE_MISMATCH");

    expect(definition.category).toBe("privacy");
    expect(definition.defaultStatus).toBe("block");
    expect(definition.defaultFallbackMode).toBe("privacy_safe");
  });

  it("classifies query/source mismatch as source suggestion rewrite", () => {
    const definition = getSafetyRailDefinition("QUERY_SOURCE_MISMATCH");

    expect(definition.category).toBe("retrieval");
    expect(definition.defaultStatus).toBe("rewrite");
    expect(definition.defaultFallbackMode).toBe("source_suggestion");
  });
});
