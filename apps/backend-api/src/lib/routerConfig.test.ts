import { describe, expect, it } from "vitest";

import {
  DEFAULT_ADAPTIVE_ROUTER_CONFIG,
  DEFAULT_ROUTER_WEIGHTS,
  getAdaptiveRouterConfig,
  getRouterWeights,
  weightedRouterScore,
} from "./routerConfig.js";

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

  it("allows adaptive router thresholds to be tuned without code changes", () => {
    expect(getAdaptiveRouterConfig({})).toEqual(DEFAULT_ADAPTIVE_ROUTER_CONFIG);

    const config = getAdaptiveRouterConfig({
      R3MES_ADAPTIVE_ROUTER_CONFIG_JSON: JSON.stringify({
        queryMatchBonusPerTerm: 5,
        routeOverrideMargin: 30,
      }),
      R3MES_ROUTER_THIN_ROUTE_PENALTY: "16",
    });

    expect(config.queryMatchBonusPerTerm).toBe(5);
    expect(config.routeOverrideMargin).toBe(30);
    expect(config.thinRoutePenalty).toBe(16);
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
