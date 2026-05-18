-- CreateTable
CREATE TABLE "WebhookIdempotencyKey" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookIdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookIdempotencyKey_idempotencyKey_key" ON "WebhookIdempotencyKey"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WebhookIdempotencyKey_provider_eventType_idx" ON "WebhookIdempotencyKey"("provider", "eventType");
