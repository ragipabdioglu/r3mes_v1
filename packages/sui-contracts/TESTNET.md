# Sui Testnet: ortam seçimi, faucet ve publish (Faz 8.6)

## Canlı deploy (R3MES)

| Alan | Değer |
|------|--------|
| İşlem | `AgXkhHzvXPN4TYWNYEZnwHgQ4dKN9LTAsDS36rg4h9Yn` |
| Explorer | [Sui Explorer (testnet)](https://suiexplorer.com/txblock/AgXkhHzvXPN4TYWNYEZnwHgQ4dKN9LTAsDS36rg4h9Yn?network=testnet) |
| `PACKAGE_ID` | `0xd5a6f9e7dd18997ed39e1e584b1ec60d636bf295fbe43ccb09cd8a906d2c0204` |

Nesne ID’leri ve `.env` güncellemeleri: `packages/shared-types/src/r3mesTestnetMock.ts`, kök ve uygulama `.env.example` dosyaları.

---

Bu dosya **gerçek ağa otomatik bağlanmaz**; geliştiricilerin Testnet’e geçiş ve gaz (SUI) temini için izleyeceği adımları ve **publish sonrası** yanıttan ID ayıklamayı özetler. Üretim anahtarlarını repoya koymayın.

## 1. CLI’yi Testnet’e alma

```bash
sui client switch --env testnet
sui client envs
sui client active-address
```

Alternatif: `~/.sui/sui/client.yaml` içinde `active_env: testnet` ve `rpc` olarak Testnet fullnode (ör. `https://fullnode.testnet.sui.io:443`).

## 2. Testnet SUI (gaz) — faucet

İşlemler **SUI** ile ödenir; R3MES coin değildir.

- **CLI (rate limit / bölgesel kısıt riski):**  
  `sui client faucet`  
  veya adres belirterek:  
  `sui client faucet --address <SUI_ADDRESS>`

- **Web / Discord:** resmi Sui geliştirici kanalları veya [Sui Wallet](https://suiwallet.com/) içi Testnet faucet (güncel linkler Mysten dokümantasyonunda).

Limitlere takılırsanız: farklı bir ağ günü, VPN politikası veya Discord faucet talimatlarını deneyin. **CI veya paylaşımlı keystore ile sınırsız faucet denemeyin** — güvenlik ve IP ban riski.

## 3. Publish (örnek komut)

Proje kökü `packages/sui-contracts`:

```bash
cd packages/sui-contracts
sui move build
sui client publish --gas-budget 100000000
```

`--gas-budget` ihtiyaca göre artırılır. Başarılı işlem çıktısında **Transaction Digest** ve **Object Changes** listesi görünür.

## 4. Yanıttan ID ayıklama (özet)

JSON veya CLI tablosunda şunlara bakın:

| Alan | Anlamı |
|------|--------|
| **Published / packageId** | Yayınlanan Move paketinin adresi → `R3MES_PACKAGE_ID` |
| **Created objects (shared)** | `AdapterRegistry`, `StakingPool`, `R3MESSupplyState` vb. → registry / pool / supply state object ID’leri |
| **Coin type** | `0x<pkg>::r3mes_coin::R3MES_COIN` → `R3MES_COIN_TYPE` |

Monorepo, `@r3mes/shared-types` içindeki `R3MES_TESTNET_MOCK_*` sabitleri ve `.env.example` dosyaları aşağıdaki **canlı testnet** değerleriyle güncellenmiştir.

### Nesne / tip eşlemesi (deploy edilmiş)

| Çevre değişkeni | Değer |
|-----------------|--------|
| `PACKAGE_ID` | `0xd5a6f9e7dd18997ed39e1e584b1ec60d636bf295fbe43ccb09cd8a906d2c0204` |
| `R3MES_COIN_TYPE` | `0xd5a6f9e7dd18997ed39e1e584b1ec60d636bf295fbe43ccb09cd8a906d2c0204::r3mes_coin::R3MES_COIN` |
| `REGISTRY_ID` (`AdapterRegistry`) | `0xc990c739735d0e873be6716d2d63e40d81501e0acdcb7284dd2ecca5a5997f6b` |
| `REWARD_POOL_ID` | `0xfedcd2a9978c0ef7d9289c147d19d1321bf9dd63540e01318dbe6be1723f6c29` |
| `STAKING_POOL_OBJECT_ID` | `0x71dd2872872d1598a0785a5ff4ccd97fb75929103de04c222b7e2cb4e1a39cf0` |
| `SUPPLY_STATE_OBJECT_ID` | `0xca010b91b53af24bdf1a99d8e47e0499724573b85d806003d73e2ebaa404658e` |
| `REGISTRY_ADMIN_CAP_OBJECT_ID` | `0x231886f18e21097e0e86b85f3de5a90ce64aa071a976323917330c894244f7c9` |
| `OPERATOR_CAP_OBJECT_ID` (`reward_pool::OperatorCap`, owned) | Paket `reward_pool::init` sonrası deployer’a transfer; **bu tx öncesi yayınlarda yoktur** — yeniden publish veya `sui client objects` ile doldurun → `R3MES_OPERATOR_CAP_OBJECT_ID` |

## 5. İlgili dosyalar

- `scripts/publish-testnet.example.sh` — komutların kopyalanabilir özeti (simülasyon).
- `../shared-types/src/r3mesTestnetMock.ts` — testnet paket / nesne ID’leri (tek kaynak).
- `apps/dApp/.env.example`, `apps/backend-api/.env.example` — `NEXT_PUBLIC_*` ve sunucu tarafı değişkenleri.
