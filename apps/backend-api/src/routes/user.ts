import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { isValidSuiAddress, normalizeSuiAddress } from "@mysten/sui/utils";
import { R3MES_TESTNET_MOCK_COIN_TYPE, R3MES_TESTNET_MOCK_PACKAGE_ID } from "@r3mes/shared-types";
import { sendApiError } from "../lib/apiErrors.js";
import { aggregateRewardTotals } from "../lib/suiRewards.js";
import { prisma } from "../lib/prisma.js";
import {
  notImplementedRewardsClaimPost,
  notImplementedStakePost,
} from "../services/onChainRestSurface.js";
import { walletAuthPreHandler } from "../lib/walletAuth.js";

function getSuiClient(): SuiClient {
  const url = process.env.SUI_RPC_URL ?? getFullnodeUrl("testnet");
  return new SuiClient({ url });
}

/** `:wallet` path — `normalizeSuiAddress` tek başına pad ile geçersiz girdiyi kabul edebilir; `isValidSuiAddress` zorunlu. */
function parseWalletParam(raw: string): { ok: true; wallet: string } | { ok: false } {
  let wallet: string;
  try {
    wallet = normalizeSuiAddress(raw);
  } catch {
    return { ok: false };
  }
  if (!isValidSuiAddress(wallet)) {
    return { ok: false };
  }
  return { ok: true, wallet };
}

export async function registerUserRoutes(app: FastifyInstance) {
  const getStake = async (
    req: FastifyRequest<{ Params: { wallet: string } }>,
    reply: FastifyReply,
  ) => {
    const parsed = parseWalletParam((req.params as { wallet: string }).wallet);
    if (!parsed.ok) {
      return sendApiError(reply, 400, "INVALID_WALLET", "Invalid Sui address");
    }
    const { wallet } = parsed;

    const positions = await prisma.stakePosition.findMany({
      where: { trainerAddress: wallet },
      orderBy: { onChainAdapterId: "asc" },
    });

    let totalStakedNano = 0n;
    for (const p of positions) {
      totalStakedNano += p.amountNano;
    }

    return {
      wallet,
      totalStakedNano: totalStakedNano.toString(),
      positions: positions.map((p) => ({
        onChainAdapterId: p.onChainAdapterId.toString(),
        amountNano: p.amountNano.toString(),
        poolObjectId: p.poolObjectId,
        updatedAt: p.updatedAt.toISOString(),
      })),
    };
  };

  /**
   * İndekslenmiş stake pozisyonları (read model).
   */
  app.get("/v1/user/:wallet/stake", getStake);
  app.get("/user/:wallet/stake", getStake);
  app.get("/v1/chain/stake/:wallet", getStake);

  app.post(
    "/v1/stake",
    { preHandler: walletAuthPreHandler },
    async (_req, reply) => {
      reply.code(501);
      return notImplementedStakePost();
    },
  );

  app.post(
    "/v1/user/:wallet/rewards/claim",
    { preHandler: walletAuthPreHandler },
    async (req, reply) => {
      const pathParsed = parseWalletParam((req.params as { wallet: string }).wallet);
      if (!pathParsed.ok) {
        return sendApiError(reply, 400, "INVALID_WALLET", "Invalid Sui address");
      }
      const pathWallet = pathParsed.wallet;
      const signed = req.verifiedWalletAddress;
      if (signed && pathWallet !== signed) {
        return sendApiError(
          reply,
          403,
          "WALLET_MISMATCH",
          "Yol parametresi imzalı cüzdan ile aynı olmalıdır",
        );
      }
      reply.code(501);
      return notImplementedRewardsClaimPost();
    },
  );

  /**
   * Opsiyonel: R3MES coin bakiyesi (Sui RPC). R3MES_COIN_TYPE yoksa coin alanı null.
   */
  const getRewards = async (
    req: FastifyRequest<{ Params: { wallet: string } }>,
    reply: FastifyReply,
  ) => {
    const rwParsed = parseWalletParam((req.params as { wallet: string }).wallet);
    if (!rwParsed.ok) {
      return sendApiError(reply, 400, "INVALID_WALLET", "Invalid Sui address");
    }
    const { wallet } = rwParsed;

    const packageId =
      process.env.R3MES_PACKAGE_ID?.trim() ?? R3MES_TESTNET_MOCK_PACKAGE_ID;

    try {
      const client = getSuiClient();
      const totals = await aggregateRewardTotals(client, packageId, wallet);
      return {
        wallet,
        source: "sui_events" as const,
        stakeWithdrawnBaseUnits: totals.stakeWithdrawnBaseUnits.toString(),
        stakeSlashedBaseUnits: totals.stakeSlashedBaseUnits.toString(),
        chatUsageFeesPaidMist: totals.chatUsageFeesPaidMist.toString(),
        eventPagesScanned: totals.pagesScanned,
      };
    } catch (e) {
      return sendApiError(
        reply,
        502,
        "REWARDS_QUERY_FAILED",
        e instanceof Error ? e.message : String(e),
      );
    }
  };

  app.get("/v1/user/:wallet/rewards", getRewards);
  app.get("/user/:wallet/rewards", getRewards);

  app.get("/v1/user/:wallet/balance", async (req, reply) => {
    const balParsed = parseWalletParam((req.params as { wallet: string }).wallet);
    if (!balParsed.ok) {
      return sendApiError(reply, 400, "INVALID_WALLET", "Invalid Sui address");
    }
    const { wallet } = balParsed;

    const coinType =
      process.env.R3MES_COIN_TYPE?.trim() ?? R3MES_TESTNET_MOCK_COIN_TYPE;

    try {
      const client = getSuiClient();
      const bal = await client.getBalance({ owner: wallet, coinType });
      return {
        wallet,
        coinType,
        coinBalance: bal.totalBalance,
      };
    } catch (e) {
      return sendApiError(reply, 502, "RPC_ERROR", e instanceof Error ? e.message : String(e));
    }
  });
}
