import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiAddress, SUI_TYPE_ARG } from "@mysten/sui/utils";
import {
  R3MES_TESTNET_MOCK_OPERATOR_CAP_OBJECT_ID,
  R3MES_TESTNET_MOCK_PACKAGE_ID,
  R3MES_TESTNET_MOCK_REGISTRY_ADMIN_CAP_OBJECT_ID,
  R3MES_TESTNET_MOCK_REWARD_POOL_OBJECT_ID,
  R3MES_TESTNET_MOCK_STAKING_POOL_OBJECT_ID,
  R3MES_TESTNET_MOCK_SUPPLY_STATE_OBJECT_ID,
} from "@r3mes/shared-types";

import { prisma } from "./prisma.js";

/** `reward_pool::record_usage` ile aynı: 1 MIST */
export const CHAT_FEE_MIST = 1n;
/** Gas için operatör bakiyesinde tutulan tampon (MIST) */
export const OPERATOR_GAS_BUFFER_MIST = 10_000_000n;

export function getSuiClient(): SuiClient {
  const url = process.env.SUI_RPC_URL ?? getFullnodeUrl("testnet");
  return new SuiClient({ url });
}

export function getOperatorKeypair(): Ed25519Keypair | null {
  const raw = process.env.R3MES_OPERATOR_PRIVATE_KEY?.trim() ?? process.env.SUI_OPERATOR_PRIVATE_KEY?.trim();
  if (!raw) return null;
  return Ed25519Keypair.fromSecretKey(raw);
}

export function getPublishedPackageId(): string {
  return process.env.R3MES_PACKAGE_ID?.trim() ?? R3MES_TESTNET_MOCK_PACKAGE_ID;
}

export function getRewardPoolObjectId(): string {
  return (
    process.env.R3MES_REWARD_POOL_OBJECT_ID?.trim() ??
    R3MES_TESTNET_MOCK_REWARD_POOL_OBJECT_ID
  );
}

/** `reward_pool::OperatorCap` owned object — `record_usage` için zorunlu. Env yoksa testnet mock (doluysa) kullanılır. */
export function getOperatorCapObjectId(): string | null {
  const env = process.env.R3MES_OPERATOR_CAP_OBJECT_ID?.trim();
  if (env) return env;
  const mock = R3MES_TESTNET_MOCK_OPERATOR_CAP_OBJECT_ID.trim();
  return mock.length > 0 ? mock : null;
}

export async function assertOperatorCanPayChatFee(): Promise<void> {
  const signer = getOperatorKeypair();
  if (!signer) throw new Error("NO_OPERATOR_KEY");
  const client = getSuiClient();
  const owner = signer.toSuiAddress();
  const bal = await client.getBalance({ owner, coinType: SUI_TYPE_ARG });
  const total = BigInt(bal.totalBalance);
  if (total < CHAT_FEE_MIST + OPERATOR_GAS_BUFFER_MIST) {
    throw new Error("INSUFFICIENT_SUI_FOR_CHAT_FEE");
  }
}

/**
 * Sistem / operatör cüzdanından 1 MIST keser, `user` adresini zincirde olay olarak kaydeder.
 */
export async function recordChatUsageOnChain(userWallet: string): Promise<{ digest: string }> {
  const pkg = getPublishedPackageId();
  const poolId = getRewardPoolObjectId();
  const signer = getOperatorKeypair();
  if (!signer) {
    throw new Error("SUI_CHAT_NOT_CONFIGURED");
  }
  const user = normalizeSuiAddress(userWallet);

  const operatorCapId = getOperatorCapObjectId();
  if (!operatorCapId) {
    throw new Error("SUI_CHAT_NOT_CONFIGURED");
  }

  const client = getSuiClient();
  const tx = new Transaction();
  const [feeCoin] = tx.splitCoins(tx.gas, [CHAT_FEE_MIST]);
  tx.moveCall({
    package: pkg,
    module: "reward_pool",
    function: "record_usage",
    arguments: [tx.object(operatorCapId), tx.object(poolId), feeCoin, tx.pure.address(user)],
  });

  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer,
    options: { showEffects: true },
    requestType: "WaitForLocalExecution",
  });

  const status = result.effects?.status?.status;
  if (status !== "success") {
    const err = result.effects?.status;
    throw new Error(
      typeof err === "object" && err && "error" in err ? String((err as { error?: string }).error) : "TX_NOT_SUCCESS",
    );
  }
  return { digest: result.digest };
}

export interface QaOnChainInput {
  approved: boolean;
  adapterObjectId: string;
  onChainAdapterId: bigint;
  rejectReasonCode: number;
}

export async function applyQaResultOnChain(input: QaOnChainInput): Promise<{ digest: string }> {
  const pkg = getPublishedPackageId();
  const adminCapId =
    process.env.R3MES_REGISTRY_ADMIN_CAP_OBJECT_ID?.trim() ??
    R3MES_TESTNET_MOCK_REGISTRY_ADMIN_CAP_OBJECT_ID;
  const stakingPoolId =
    process.env.R3MES_STAKING_POOL_OBJECT_ID?.trim() ??
    R3MES_TESTNET_MOCK_STAKING_POOL_OBJECT_ID;
  const supplyStateId =
    process.env.R3MES_SUPPLY_STATE_OBJECT_ID?.trim() ??
    R3MES_TESTNET_MOCK_SUPPLY_STATE_OBJECT_ID;
  const signer = getOperatorKeypair();

  if (!signer) {
    throw new Error("SUI_QA_NOT_CONFIGURED");
  }

  const client = getSuiClient();
  const tx = new Transaction();

  if (input.approved) {
    tx.moveCall({
      package: pkg,
      module: "adapter_registry",
      function: "approve_adapter",
      arguments: [tx.object(adminCapId), tx.object(input.adapterObjectId)],
    });
  } else {
    tx.moveCall({
      package: pkg,
      module: "adapter_registry",
      function: "reject_adapter",
      arguments: [
        tx.object(adminCapId),
        tx.object(input.adapterObjectId),
        tx.pure.u8(input.rejectReasonCode),
      ],
    });
    const hasStake = await hasIndexedStake(input.onChainAdapterId);
    if (hasStake) {
      if (!stakingPoolId || !supplyStateId) {
        throw new Error("SUI_SLASH_NOT_CONFIGURED");
      }
      tx.moveCall({
        package: pkg,
        module: "staking_pool",
        function: "slash_stake_on_rejected",
        arguments: [
          tx.object(stakingPoolId),
          tx.object(input.adapterObjectId),
          tx.object(supplyStateId),
          tx.object(adminCapId),
          tx.pure.u8(input.rejectReasonCode),
        ],
      });
    }
  }

  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer,
    options: { showEffects: true },
    requestType: "WaitForLocalExecution",
  });

  if (result.effects?.status?.status !== "success") {
    const err = result.effects?.status;
    throw new Error(
      typeof err === "object" && err && "error" in err ? String((err as { error?: string }).error) : "TX_NOT_SUCCESS",
    );
  }
  return { digest: result.digest };
}

async function hasIndexedStake(onChainAdapterId: bigint): Promise<boolean> {
  const row = await prisma.stakePosition.findUnique({
    where: { onChainAdapterId },
  });
  return row !== null && row.amountNano > 0n;
}
