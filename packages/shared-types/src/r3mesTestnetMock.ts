/**
 * Sui **Testnet** üzerinde yayınlanmış R3MES paket sabitleri (gerçek deploy).
 *
 * Publish tx: `AgXkhHzvXPN4TYWNYEZnwHgQ4dKN9LTAsDS36rg4h9Yn` (testnet, epoch ~1064).
 * Paket modülleri: `adapter_registry`, `r3mes_coin`, `reward_pool`, `staking_pool`.
 *
 * İsim `R3MES_TESTNET_MOCK_*` kalır (geri uyumluluk); değerler artık mock değildir.
 */
export const R3MES_TESTNET_MOCK_PACKAGE_ID =
  "0xd5a6f9e7dd18997ed39e1e584b1ec60d636bf295fbe43ccb09cd8a906d2c0204";

/** Move `Coin<R3MES_COIN>` tam tip yolu (modül `r3mes_coin`, struct `R3MES_COIN`). */
export const R3MES_TESTNET_MOCK_COIN_TYPE = `${R3MES_TESTNET_MOCK_PACKAGE_ID}::r3mes_coin::R3MES_COIN`;

/** Paylaşımlı `AdapterRegistry`. */
export const R3MES_TESTNET_MOCK_ADAPTER_REGISTRY_OBJECT_ID =
  "0xc990c739735d0e873be6716d2d63e40d81501e0acdcb7284dd2ecca5a5997f6b";

/** Paylaşımlı `RewardPool` (SUI ücret havuzu). */
export const R3MES_TESTNET_MOCK_REWARD_POOL_OBJECT_ID =
  "0xfedcd2a9978c0ef7d9289c147d19d1321bf9dd63540e01318dbe6be1723f6c29";

/** Paylaşımlı `StakingPool`. */
export const R3MES_TESTNET_MOCK_STAKING_POOL_OBJECT_ID =
  "0x71dd2872872d1598a0785a5ff4ccd97fb75929103de04c222b7e2cb4e1a39cf0";

/** Paylaşımlı `R3MESSupplyState`. */
export const R3MES_TESTNET_MOCK_SUPPLY_STATE_OBJECT_ID =
  "0xca010b91b53af24bdf1a99d8e47e0499724573b85d806003d73e2ebaa404658e";

/** Yayın sonrası deployer adresine transfer edilen `RegistryAdminCap`. */
export const R3MES_TESTNET_MOCK_REGISTRY_ADMIN_CAP_OBJECT_ID =
  "0x231886f18e21097e0e86b85f3de5a90ce64aa071a976323917330c894244f7c9";

/**
 * Owned `reward_pool::OperatorCap` — `init` içinde deployer adresine transfer edilir; `record_usage` ilk argümanı.
 * Eski testnet tx (`AgXkhHzv...`) çıktısında bu nesne yoksa veya paket `OperatorCap` öncesi yayınlandıysa boş kalır:
 * yeni publish sonrası objectChanges veya deployer cüzdanı nesne listesinden doldurun veya `R3MES_OPERATOR_CAP_OBJECT_ID` kullanın.
 */
export const R3MES_TESTNET_MOCK_OPERATOR_CAP_OBJECT_ID = "";
