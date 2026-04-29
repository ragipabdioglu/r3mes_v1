/// LoRA / adaptor kayıtları: eğitici adresi, IPFS CID, durum (Pending / Active / Rejected).
#[allow(duplicate_alias)]
module r3mes::adapter_registry;

use std::string::String;
use sui::event;

// --- Status (LoRA model lifecycle) ---
const STATUS_PENDING: u8 = 0;
const STATUS_ACTIVE: u8 = 1;
const STATUS_REJECTED: u8 = 2;

public fun status_pending(): u8 { STATUS_PENDING }
public fun status_active(): u8 { STATUS_ACTIVE }
public fun status_rejected(): u8 { STATUS_REJECTED }

// --- Errors ---
const ENotOwner: u64 = 0;
const EInvalidStatusTransition: u64 = 1;

/// Global sayaç ve paylaşımlı kayıt defteri.
public struct AdapterRegistry has key {
    id: UID,
    next_adapter_id: u64,
}

/// Her LoRA yüklemesi için paylaşımlı nesne (indexer nesne ID ile izler).
public struct Adapter has key, store {
    id: UID,
    adapter_id: u64,
    creator: address,
    ipfs_cid: String,
    status: u8,
}

/// Yönetici: onay / red (slash tetikleyici backend ile uyumlu).
public struct RegistryAdminCap has key, store {
    id: UID,
}

// --- Events (Backend indexer) ---
public struct AdapterUploadedEvent has copy, drop, store {
    adapter_id: u64,
    object_id: ID,
    creator: address,
    ipfs_cid: String,
}

public struct AdapterApprovedEvent has copy, drop, store {
    adapter_id: u64,
    object_id: ID,
}

public struct AdapterRejectedEvent has copy, drop, store {
    adapter_id: u64,
    object_id: ID,
    reason_code: u8,
}

fun init(ctx: &mut TxContext) {
    transfer::share_object(AdapterRegistry {
        id: object::new(ctx),
        next_adapter_id: 0,
    });
    transfer::transfer(
        RegistryAdminCap { id: object::new(ctx) },
        ctx.sender(),
    );
}

/// Yeni adaptor kaydı — `Pending` durumunda paylaşımlı nesne oluşturur.
public fun register_adapter(
    registry: &mut AdapterRegistry,
    ipfs_cid: String,
    ctx: &mut TxContext,
) {
    let id = registry.next_adapter_id;
    registry.next_adapter_id = registry.next_adapter_id + 1;

    let adapter_obj = Adapter {
        id: object::new(ctx),
        adapter_id: id,
        creator: ctx.sender(),
        ipfs_cid,
        status: STATUS_PENDING,
    };
    let oid = object::id(&adapter_obj);
    let cid_copy = adapter_obj.ipfs_cid;
    event::emit(AdapterUploadedEvent {
        adapter_id: id,
        object_id: oid,
        creator: ctx.sender(),
        ipfs_cid: cid_copy,
    });
    transfer::share_object(adapter_obj);
}

public fun approve_adapter(_: &RegistryAdminCap, adapter: &mut Adapter) {
    assert!(adapter.status == STATUS_PENDING, EInvalidStatusTransition);
    adapter.status = STATUS_ACTIVE;
    event::emit(AdapterApprovedEvent {
        adapter_id: adapter.adapter_id,
        object_id: object::id(adapter),
    });
}

public fun reject_adapter(_: &RegistryAdminCap, adapter: &mut Adapter, reason_code: u8) {
    assert!(adapter.status == STATUS_PENDING, EInvalidStatusTransition);
    adapter.status = STATUS_REJECTED;
    event::emit(AdapterRejectedEvent {
        adapter_id: adapter.adapter_id,
        object_id: object::id(adapter),
        reason_code,
    });
}

// --- Getters ---
public fun adapter_id(a: &Adapter): u64 {
    a.adapter_id
}

public fun creator(a: &Adapter): address {
    a.creator
}

public fun ipfs_cid(a: &Adapter): String {
    a.ipfs_cid
}

public fun status(a: &Adapter): u8 {
    a.status
}

public fun assert_creator(adapter: &Adapter, ctx: &TxContext) {
    assert!(adapter.creator == ctx.sender(), ENotOwner);
}

#[test_only]
public fun init_for_unit_tests(ctx: &mut TxContext): (AdapterRegistry, RegistryAdminCap) {
    let reg = AdapterRegistry {
        id: object::new(ctx),
        next_adapter_id: 0,
    };
    let cap = RegistryAdminCap { id: object::new(ctx) };
    (reg, cap)
}

/// Test senaryolarında durum geçişini simüle etmek için (yalnızca #[test_only]).
#[test_only]
public fun set_status_for_testing(adapter: &mut Adapter, status: u8) {
    adapter.status = status;
}

/// Birim testlerde `&Adapter` sağlamak için (nesne zincire yazılmaz).
#[test_only]
public fun build_adapter_for_test(
    ctx: &mut TxContext,
    adapter_id: u64,
    creator: address,
    ipfs: vector<u8>,
    status: u8,
): Adapter {
    Adapter {
        id: object::new(ctx),
        adapter_id,
        creator,
        ipfs_cid: std::string::utf8(ipfs),
        status,
    }
}

#[test_only]
public fun mint_registry_admin_cap_for_test(ctx: &mut TxContext): RegistryAdminCap {
    RegistryAdminCap { id: object::new(ctx) }
}
