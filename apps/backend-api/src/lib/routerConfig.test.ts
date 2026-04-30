import { describe, expect, it } from "vitest";

import { DEFAULT_ROUTER_WEIGHTS, getRouterWeights, weightedRouterScore } from "./routerConfig.js";

describe("router config", () => {
  it("normalizes default router weights", () => {
    expect(getRouterWeights({})).toEqual(DEFAULT_ROUTER_WEIGHTS);
  });

  it("allows json and per-field env overrides", () => {
    const weights = getRouterWeights({
      R3MES_ROUTER_WEIGHTS_JSON: JSON.stringify({
        profileEmbedding: 2,
        lexicalKeyword: 1,
        sampleQuestion: 1,
        domainHint: 1,
        sourceQuality: 1,
      }),
      R3MES_ROUTER_WEIGHT_DOMAIN_HINT: "3",
    });

    expect(weights.domainHint).toBeCloseTo(3 / 8);
    expect(weights.profileEmbedding).toBeCloseTo(2 / 8);
  });

  it("renormalizes active score signals when a phase is not available yet", () => {
    const score = weightedRouterScore(
      {
        profileEmbedding: null,
        lexicalKeyword: 100,
        sampleQuestion: 0,
      },
      DEFAULT_ROUTER_WEIGHTS,
    );

    expect(score).toBeCloseTo(62.5);
  });
});
