CREATE TABLE "external_provider_api_logs" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "requestHeaders" JSONB,
    "requestBody" JSONB,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "success" BOOLEAN NOT NULL,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_provider_api_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "external_provider_api_logs_provider_createdAt_idx" ON "external_provider_api_logs"("provider", "createdAt");
CREATE INDEX "external_provider_api_logs_success_createdAt_idx" ON "external_provider_api_logs"("success", "createdAt");
CREATE INDEX "external_provider_api_logs_createdAt_idx" ON "external_provider_api_logs"("createdAt");
