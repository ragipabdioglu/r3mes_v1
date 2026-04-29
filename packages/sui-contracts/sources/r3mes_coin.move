/// R3MES fungible token: genesis mint, sonra `TreasuryCap` kaldırılarak enflasyon kapatılır.
/// Dolaşımdan düşürmek için `Supply` üzerinden `decrease_supply` (slash / protokol yakımı).
#[allow(deprecated_usage)]
module r3mes::r3mes_coin;

use sui::balance::{Self, Supply};
use sui::coin::{Self, Coin};
use sui::event;

/// One-time witness — modül adı `r3mes_coin` → tip `R3MES_COIN` (Sui OTW kuralı).
public struct R3MES_COIN has drop {}

/// Genesis sonrası tüm `R3MES_COIN` arzı burada tutulur; `TreasuryCap` yoktur → yeni mint imkansız.
public struct R3MESSupplyState has key {
    id: UID,
    supply: Supply<R3MES_COIN>,
}

// --- Constants ---
/// Toplam arz (6 ondalık): 1_000_000_000 * 10^6
const GENESIS_TOTAL_SUPPLY: u64 = 1_000_000_000_000_000;
const DECIMALS: u8 = 6;

// --- Errors ---
const EBadWitness: u64 = 0;
const EZeroBurn: u64 = 1;

/// Mint yetkisi kalıcı olarak kapatıldığında (genesis sonrası).
public struct MintingSealedEvent has copy, drop, store {
    final_total_supply: u64,
}

fun init(otw: R3MES_COIN, ctx: &mut TxContext) {
    assert!(sui::types::is_one_time_witness(&otw), EBadWitness);

    let (mut treasury_cap, metadata) = coin::create_currency(
        otw,
        DECIMALS,
        b"R3MES",
        b"R3MES Token",
        b"R3MES decentralized AI training platform token — fixed supply, no inflation.",
        option::none(),
        ctx,
    );
    transfer::public_freeze_object(metadata);

    let genesis_coin = coin::mint(&mut treasury_cap, GENESIS_TOTAL_SUPPLY, ctx);
    let supply = coin::treasury_into_supply(treasury_cap);

    event::emit(MintingSealedEvent { final_total_supply: balance::supply_value(&supply) });

    let state = R3MESSupplyState {
        id: object::new(ctx),
        supply,
    };
    transfer::share_object(state);
    transfer::public_transfer(genesis_coin, ctx.sender());
}

/// Dolaşımdaki coinleri protokol arzından düşürür (slash, yakım). `TreasuryCap` olmadan çalışır.
public(package) fun burn_from_circulation(state: &mut R3MESSupplyState, coin: Coin<R3MES_COIN>) {
    assert!(coin::value(&coin) > 0, EZeroBurn);
    let b = coin::into_balance(coin);
    balance::decrease_supply(&mut state.supply, b);
}

public fun total_supply(state: &R3MESSupplyState): u64 {
    balance::supply_value(&state.supply)
}

#[test_only]
public fun init_for_unit_tests(ctx: &mut TxContext): (R3MESSupplyState, Coin<R3MES_COIN>) {
    let mut cap = coin::create_treasury_cap_for_testing<R3MES_COIN>(ctx);
    let c = coin::mint(&mut cap, 10_000, ctx);
    let supply = coin::treasury_into_supply(cap);
    let state = R3MESSupplyState {
        id: object::new(ctx),
        supply,
    };
    (state, c)
}

#[test_only]
public fun burn_from_circulation_for_testing(state: &mut R3MESSupplyState, coin: Coin<R3MES_COIN>) {
    burn_from_circulation(state, coin);
}
