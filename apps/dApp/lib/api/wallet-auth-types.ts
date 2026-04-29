/** İmzalı isteklerde backend’in doğrulaması için gönderilen başlıklar (Faz 8.3). */
export type R3mesWalletAuthHeaders = {
  "X-Signature": string;
  "X-Message": string;
  "X-Wallet-Address": string;
};
