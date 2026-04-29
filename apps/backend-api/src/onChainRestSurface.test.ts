import { describe, expect, it } from "vitest";
import {
  ON_CHAIN_REST_READINESS,
  ON_CHAIN_REST_SURFACE_POLICY_FAZ5,
  notImplementedRewardsClaimPost,
  notImplementedStakePost,
} from "./services/onChainRestSurface.js";

describe("onChainRestSurface (501 readiness boundary)", () => {
  it("Faz 5: 501 surfaces are consciously kept, not implied backlog", () => {
    expect(ON_CHAIN_REST_SURFACE_POLICY_FAZ5["POST /v1/stake"]).toBe("conscious_keep_501");
    expect(ON_CHAIN_REST_SURFACE_POLICY_FAZ5["POST /v1/user/:wallet/rewards/claim"]).toBe(
      "conscious_keep_501",
    );
  });

  it("exposes explicit not_implemented phase for stake and claim", () => {
    expect(ON_CHAIN_REST_READINESS.stakePost).toBe("not_implemented");
    expect(ON_CHAIN_REST_READINESS.rewardsClaimPost).toBe("not_implemented");
  });

  it("stake POST body matches NotImplementedOnChainRestResponse", () => {
    const b = notImplementedStakePost();
    expect(b.success).toBe(false);
    expect(b.code).toBe("NOT_IMPLEMENTED");
    expect(b.surface).toBe("POST /v1/stake");
    expect(typeof b.message).toBe("string");
  });

  it("claim POST body matches NotImplementedOnChainRestResponse", () => {
    const b = notImplementedRewardsClaimPost();
    expect(b.success).toBe(false);
    expect(b.code).toBe("NOT_IMPLEMENTED");
    expect(b.surface).toBe("POST /v1/user/:wallet/rewards/claim");
  });
});
