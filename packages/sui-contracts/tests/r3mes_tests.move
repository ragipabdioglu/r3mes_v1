#[test_only]
#[allow(duplicate_alias, unused_use)]
module r3mes::r3mes_tests;

use r3mes::adapter_registry::{Self};
use r3mes::r3mes_coin::{Self, R3MES_COIN};
use r3mes::reward_pool::{Self};
use r3mes::staking_pool::{Self};
use std::unit_test::assert_eq;
use sui::coin::{Self};
use sui::sui::SUI;
use sui::test_utils::destroy;
use sui::tx_context::{Self, TxContext};

const TRAINER: address = @0xBEEF;

fun fresh_ctx(sender: address): TxContext {
    tx_context::new(sender, tx_context::dummy_tx_hash_with_hint(1), 0, 0, 0)
}

#[test]
fun test_burn_reduces_total_supply() {
    let mut ctx = fresh_ctx(@0x1);
    let ctx_ref = &mut ctx;
    let (mut state, mut coin) = r3mes_coin::init_for_unit_tests(ctx_ref);
    let before = r3mes_coin::total_supply(&state);
    let chunk = coin::split(&mut coin, 3_000, ctx_ref);
    r3mes_coin::burn_from_circulation_for_testing(&mut state, chunk);
    assert_eq!(r3mes_coin::total_supply(&state), before - 3_000);
    destroy(coin);
    destroy(state);
}

#[test]
fun test_stake_deposit_and_withdraw_after_active() {
    let mut ctx = fresh_ctx(TRAINER);
    let ctx_ref = &mut ctx;
    let mut pool = staking_pool::init_pool_for_testing(ctx_ref);
    let mut adapter = adapter_registry::build_adapter_for_test(
        ctx_ref,
        42,
        TRAINER,
        b"QmWithdraw",
        adapter_registry::status_pending(),
    );
    let coin_in = coin::mint_for_testing<R3MES_COIN>(5_000, ctx_ref);
    staking_pool::deposit_stake(&mut pool, &adapter, coin_in, ctx_ref);
    assert_eq!(staking_pool::staked_amount(&pool, 42), 5_000);

    adapter_registry::set_status_for_testing(&mut adapter, adapter_registry::status_active());
    let out = staking_pool::withdraw_stake_after_approval(&mut pool, &adapter, ctx_ref);
    assert_eq!(coin::value(&out), 5_000);
    assert_eq!(staking_pool::staked_amount(&pool, 42), 0);

    destroy(out);
    destroy(adapter);
    destroy(pool);
}

#[test]
fun test_slash_burns_stake_on_rejected() {
    let mut ctx = fresh_ctx(TRAINER);
    let ctx_ref = &mut ctx;
    let (mut supply_state, mut genesis_coin) = r3mes_coin::init_for_unit_tests(ctx_ref);
    let supply_before = r3mes_coin::total_supply(&supply_state);

    let mut pool = staking_pool::init_pool_for_testing(ctx_ref);
    let mut adapter = adapter_registry::build_adapter_for_test(
        ctx_ref,
        99,
        TRAINER,
        b"QmSlash",
        adapter_registry::status_pending(),
    );
    let stake_coin = coin::split(&mut genesis_coin, 4_000, ctx_ref);
    staking_pool::deposit_stake(&mut pool, &adapter, stake_coin, ctx_ref);

    adapter_registry::set_status_for_testing(&mut adapter, adapter_registry::status_rejected());
    let (dummy_reg, cap) = adapter_registry::init_for_unit_tests(ctx_ref);
    staking_pool::slash_stake_on_rejected(&mut pool, &adapter, &mut supply_state, &cap, 2, ctx_ref);

    assert_eq!(staking_pool::staked_amount(&pool, 99), 0);
    assert_eq!(r3mes_coin::total_supply(&supply_state), supply_before - 4_000);

    destroy(genesis_coin);
    destroy(adapter);
    destroy(pool);
    destroy(cap);
    destroy(dummy_reg);
    destroy(supply_state);
}

#[test]
#[expected_failure(abort_code = 1, location = r3mes::staking_pool)]
fun test_stake_fails_when_not_pending() {
    let mut ctx = fresh_ctx(TRAINER);
    let ctx_ref = &mut ctx;
    let mut pool = staking_pool::init_pool_for_testing(ctx_ref);
    let adapter = adapter_registry::build_adapter_for_test(
        ctx_ref,
        1,
        TRAINER,
        b"QmBad",
        adapter_registry::status_active(),
    );
    let c = coin::mint_for_testing<R3MES_COIN>(5_000, ctx_ref);
    staking_pool::deposit_stake(&mut pool, &adapter, c, ctx_ref);
    destroy(pool);
    destroy(adapter);
}

#[test]
#[expected_failure(abort_code = 1, location = r3mes::adapter_registry)]
fun test_double_approve_fails() {
    let mut ctx = fresh_ctx(@0x7);
    let ctx_ref = &mut ctx;
    let cap = adapter_registry::mint_registry_admin_cap_for_test(ctx_ref);
    let mut adapter = adapter_registry::build_adapter_for_test(
        ctx_ref,
        0,
        @0x7,
        b"QmX",
        adapter_registry::status_pending(),
    );
    adapter_registry::approve_adapter(&cap, &mut adapter);
    adapter_registry::approve_adapter(&cap, &mut adapter);
    destroy(adapter);
    destroy(cap);
}

#[test]
fun test_record_usage_accrues_one_mist() {
    let mut ctx = fresh_ctx(@0x1);
    let ctx_ref = &mut ctx;
    let cap = reward_pool::mint_operator_cap_for_test(ctx_ref);
    let mut pool = reward_pool::init_pool_for_testing(ctx_ref);
    let fee = coin::mint_for_testing<SUI>(1, ctx_ref);
    reward_pool::record_usage(&cap, &mut pool, fee, @0xCAFE);
    assert_eq!(reward_pool::vault_balance_mist(&pool), 1);
    destroy(cap);
    destroy(pool);
}

#[test]
#[expected_failure(abort_code = 999, location = r3mes::reward_pool)]
fun test_record_usage_aborts_when_paused() {
    let mut ctx = fresh_ctx(@0x1);
    let ctx_ref = &mut ctx;
    let cap = reward_pool::mint_operator_cap_for_test(ctx_ref);
    let mut pool = reward_pool::init_pool_for_testing(ctx_ref);
    reward_pool::set_paused(&cap, &mut pool, true);
    let fee = coin::mint_for_testing<SUI>(1, ctx_ref);
    reward_pool::record_usage(&cap, &mut pool, fee, @0x1);
    destroy(cap);
    destroy(pool);
}

#[test]
fun test_withdraw_rewards_reduces_vault() {
    let mut ctx = fresh_ctx(@0x1);
    let ctx_ref = &mut ctx;
    let cap = reward_pool::mint_operator_cap_for_test(ctx_ref);
    let mut pool = reward_pool::init_pool_for_testing(ctx_ref);
    reward_pool::record_usage(&cap, &mut pool, coin::mint_for_testing<SUI>(1, ctx_ref), @0xA);
    reward_pool::record_usage(&cap, &mut pool, coin::mint_for_testing<SUI>(1, ctx_ref), @0xA);
    reward_pool::record_usage(&cap, &mut pool, coin::mint_for_testing<SUI>(1, ctx_ref), @0xA);
    assert_eq!(reward_pool::vault_balance_mist(&pool), 3);
    let out = reward_pool::withdraw_rewards(&cap, &mut pool, 2, ctx_ref);
    assert_eq!(coin::value(&out), 2);
    assert_eq!(reward_pool::vault_balance_mist(&pool), 1);
    destroy(out);
    destroy(cap);
    destroy(pool);
}

#[test]
#[expected_failure(abort_code = 0, location = r3mes::reward_pool)]
fun test_record_usage_rejects_wrong_mist_amount() {
    let mut ctx = fresh_ctx(@0x1);
    let ctx_ref = &mut ctx;
    let cap = reward_pool::mint_operator_cap_for_test(ctx_ref);
    let mut pool = reward_pool::init_pool_for_testing(ctx_ref);
    let fee = coin::mint_for_testing<SUI>(2, ctx_ref);
    reward_pool::record_usage(&cap, &mut pool, fee, @0x1);
    destroy(cap);
    destroy(pool);
}
