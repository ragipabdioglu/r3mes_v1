/// Chat / inference başına SUI (MIST) ücret havuzu. `StakingPool` (R3MES) ve `R3MESSupplyState`
/// ile aynı pakette yayınlanır; ücret burada SUI olarak birikir, R3MES stake akışından bağımsızdır.
#[allow(duplicate_alias)]
module r3mes::reward_pool;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::event;
use sui::sui::SUI;
use sui::transfer;

/// Backend `CHAT_FEE_MIST` ile aynı: tam olarak 1 MIST.
const USAGE_FEE_MIST: u64 = 1;

const EWrongFeeAmount: u64 = 0;

public struct OperatorCap has key, store {
    id: UID,
}

/// Paylaşımlı ödül / ücret havuzu (SUI).
public struct RewardPool has key {
    id: UID,
    sui_vault: Balance<SUI>,
    is_paused: bool,
}

public struct UsageRecordedEvent has copy, drop, store {
    pool_id: ID,
    user: address,
    amount_mist: u64,
}

/// Paket yayınında bir kez: boş havuzu zincire açar.
fun init(ctx: &mut TxContext) {
    create_pool(ctx);
    transfer::transfer(OperatorCap { id: object::new(ctx) }, ctx.sender());
}

/// Genesis yapılandırması — paylaşımlı `RewardPool` oluşturur.
fun create_pool(ctx: &mut TxContext) {
    transfer::share_object(RewardPool {
        id: object::new(ctx),
        sui_vault: balance::zero(),
        is_paused: false,
    });
}

/// Operatör `Coin<SUI>` ile 1 MIST gönderir; havuza eklenir ve olay yayınlanır.
public fun record_usage(_: &OperatorCap, pool: &mut RewardPool, fee: Coin<SUI>, user: address) {
    assert!(!pool.is_paused, 999);
    assert!(coin::value(&fee) == USAGE_FEE_MIST, EWrongFeeAmount);
    coin::put(&mut pool.sui_vault, fee);
    event::emit(UsageRecordedEvent {
        pool_id: object::id(pool),
        user,
        amount_mist: USAGE_FEE_MIST,
    });
}

public fun withdraw_rewards(
    _: &OperatorCap,
    pool: &mut RewardPool,
    amount: u64,
    ctx: &mut TxContext,
): Coin<SUI> {
    assert!(!pool.is_paused, 999);
    coin::take(&mut pool.sui_vault, amount, ctx)
}

public fun set_paused(_: &OperatorCap, pool: &mut RewardPool, paused: bool) {
    pool.is_paused = paused;
}

public fun vault_balance_mist(pool: &RewardPool): u64 {
    balance::value(&pool.sui_vault)
}

#[test_only]
public fun init_pool_for_testing(ctx: &mut TxContext): RewardPool {
    RewardPool {
        id: object::new(ctx),
        sui_vault: balance::zero(),
        is_paused: false,
    }
}

#[test_only]
public fun mint_operator_cap_for_test(ctx: &mut TxContext): OperatorCap {
    OperatorCap { id: object::new(ctx) }
}
