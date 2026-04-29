-- Wallet auth: imza mesajı jti tek kullanımlık (Faz 5)
CREATE TABLE "WalletAuthJti" (
    "jti" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletAuthJti_pkey" PRIMARY KEY ("jti")
);

CREATE INDEX "WalletAuthJti_expiresAt_idx" ON "WalletAuthJti"("expiresAt");
