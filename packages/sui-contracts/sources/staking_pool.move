/// Eğitici stake havuzu ve reddedilmiş (çöp) adaptörlerde slash (yakım).
#[allow(duplicate_alias)]
module r3mes::staking_pool;

use r3mes::adapter_registry::{Self, Adapter, RegistryAdminCap};
use r3mes::r3mes_coin::{Self, R3MES_COIN, R3MESSupplyState};
use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::event;
use sui::table::{Self, Table};
use sui::transfer;

/// Minimum stake (R3MES en küçük birimi).
const MIN_STAKE: u64 = 1_000;

// --- Errors ---
const ENotTrainer: u64 = 0;
const EWrongStatusForStake: u64 = 1;
const EBelowMinStake: u64 = 2;
const EAlreadyStaked: u64 = 3;
const ENoStake: u64 = 4;
const EWrongStatusForWithdraw: u64 = 5;
const EWrongStatusForSlash: u64 = 6;

/// Havuz: toplam kilitli bakiye + adaptor_id başına kayıtlı miktar.
public struct StakingPool has key {
    id: UID,
    staked_balance: Balance<R3MES_COIN>,
    stakes: Table<u64, u64>,
}

public struct StakeDepositedEvent has copy, drop, store {
    adapter_id: u64,
    trainer: address,
    amount: u64,
    pool_object_id: ID,
}

public struct StakeWithdrawnEvent has copy, drop, store {
    adapter_id: u64,
    trainer: address,
    amount: u64,
}

public struct StakeSlashedEvent has copy, drop, store {
    adapter_id: u64,
    trainer: address,
    amount: u64,
    reason_code: u8,
}

fun init(ctx: &mut TxContext) {
    transfer::share_object(StakingPool {
        id: object::new(ctx),
        staked_balance: balance::zero(),
        stakes: table::new(ctx),
    });
}

/// LoRA ekleme aşamasında — yalnızca `Pending` adaptör ve eğitici cüzdanı.
public fun deposit_stake(
    pool: &mut StakingPool,
    adapter: &Adapter,
    coin: Coin<R3MES_COIN>,
    ctx: &mut TxContext,
) {
    assert!(adapter_registry::creator(adapter) == ctx.sender(), ENotTrainer);
    assert!(adapter_registry::status(adapter) == adapter_registry::status_pending(), EWrongStatusForStake);
    let amt = coin::value(&coin);
    assert!(amt >= MIN_STAKE, EBelowMinStake);
    assert!(!table::contains(&pool.stakes, adapter_registry::adapter_id(adapter)), EAlreadyStaked);

    let id = adapter_registry::adapter_id(adapter);
    coin::put(&mut pool.staked_balance, coin);
    table::add(&mut pool.stakes, id, amt);
    event::emit(StakeDepositedEvent {
        adapter_id: id,
        trainer: ctx.sender(),
        amount: amt,
        pool_object_id: object::id(pool),
    });
}

/// Benchmark / onay sonrası stake iadesi (`Active`).
public fun withdraw_stake_after_approval(
    pool: &mut StakingPool,
    adapter: &Adapter,
    ctx: &mut TxContext,
): Coin<R3MES_COIN> {
    assert!(adapter_registry::creator(adapter) == ctx.sender(), ENotTrainer);
    assert!(adapter_registry::status(adapter) == adapter_registry::status_active(), EWrongStatusForWithdraw);
    let id = adapter_registry::adapter_id(adapter);
    assert!(table::contains(&pool.stakes, id), ENoStake);
    let amt = table::remove(&mut pool.stakes, id);
    let out = coin::take(&mut pool.staked_balance, amt, ctx);
    event::emit(StakeWithdrawnEvent {
        adapter_id: id,
        trainer: ctx.sender(),
        amount: amt,
    });
    out
}

/// Reddedilmiş adaptörde stake'i protokol yakımı ile keser (slash).
public fun slash_stake_on_rejected(
    pool: &mut StakingPool,
    adapter: &Adapter,
    supply_state: &mut R3MESSupplyState,
    _: &RegistryAdminCap,
    reason_code: u8,
    ctx: &mut TxContext,
) {
    assert!(adapter_registry::status(adapter) == adapter_registry::status_rejected(), EWrongStatusForSlash);
    let id = adapter_registry::adapter_id(adapter);
    assert!(table::contains(&pool.stakes, id), ENoStake);
    let amt = table::remove(&mut pool.stakes, id);
    let coin_out = coin::take(&mut pool.staked_balance, amt, ctx);
    let trainer = adapter_registry::creator(adapter);
    r3mes_coin::burn_from_circulation(supply_state, coin_out);
    event::emit(StakeSlashedEvent {
        adapter_id: id,
        trainer,
        amount: amt,
        reason_code,
    });
}

public fun staked_amount(pool: &StakingPool, adapter_id: u64): u64 {
    if (table::contains(&pool.stakes, adapter_id)) {
        *table::borrow(&pool.stakes, adapter_id)
    } else {
        0
    }
}

#[test_only]
public fun init_pool_for_testing(ctx: &mut TxContext): StakingPool {
    StakingPool {
        id: object::new(ctx),
        staked_balance: balance::zero(),
        stakes: table::new(ctx),
    }
}
